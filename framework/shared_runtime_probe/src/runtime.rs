//! Concrete networking work lives here, not generic reexports instantiated twice.
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use http_body_util::{BodyExt, Full};
use hyper::{Request, Response, body::Bytes, service::service_fn};
use hyper_util::rt::TokioIo;
use std::{
    convert::Infallible,
    io::{Read, Write},
    time::Duration,
};
use tokio::net::{TcpListener, TcpStream};

const IMPLEMENTATION_REVISION: u32 = 1;

pub fn run(label: &str) -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(5), exchange(label))
            .await
            .map_err(|e| e.to_string())?
    })
}

async fn exchange(label: &str) -> Result<String, String> {
    let expected = format!("{label}:revision={IMPLEMENTATION_REVISION}\n").repeat(256);
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(expected.as_bytes())
        .map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;
    let compressed_len = compressed.len();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await?;
        hyper::server::conn::http1::Builder::new()
            .keep_alive(false)
            .serve_connection(
                TokioIo::new(stream),
                service_fn(move |_| {
                    let body = compressed.clone();
                    async move {
                        Ok::<_, Infallible>(
                            Response::builder()
                                .header("content-encoding", "gzip")
                                .body(Full::new(Bytes::from(body)))
                                .unwrap(),
                        )
                    }
                }),
            )
            .await
            .map_err(std::io::Error::other)
    });
    let stream = TcpStream::connect(address)
        .await
        .map_err(|e| e.to_string())?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|e| e.to_string())?;
    let client = tokio::spawn(connection);
    let response = sender
        .send_request(
            Request::builder()
                .uri("/probe")
                .header("host", "localhost")
                .body(Full::new(Bytes::new()))
                .unwrap(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if response
        .headers()
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        != Some("gzip")
    {
        return Err("missing gzip response".into());
    }
    let body = response
        .into_body()
        .collect()
        .await
        .map_err(|e| e.to_string())?
        .to_bytes();
    let mut decoded = String::new();
    GzDecoder::new(body.as_ref())
        .read_to_string(&mut decoded)
        .map_err(|e| e.to_string())?;
    if decoded != expected {
        return Err("HTTP/gzip roundtrip mismatch".into());
    }
    drop(sender);
    client
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    server
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "{label}: revision={IMPLEMENTATION_REVISION} bytes={} gzip={compressed_len}",
        decoded.len()
    ))
}
