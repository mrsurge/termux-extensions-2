//! Shared opt-in policy for HTTP asset delivery, never application transports.
use http::{Extensions, HeaderMap, StatusCode, Version, header};
use tower_http::compression::predicate::{DefaultPredicate, Predicate};

#[derive(Clone, Copy)]
pub struct AssetResponse;

pub fn allow_request<B>(request: &http::Request<B>) -> bool {
    request.method() == http::Method::GET && !request.headers().contains_key(header::RANGE)
}

pub fn predicate() -> impl Predicate {
    DefaultPredicate::new().and(
        |status: StatusCode, _: Version, headers: &HeaderMap, extensions: &Extensions| {
            let mime = headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            status == StatusCode::OK
                && extensions.get::<AssetResponse>().is_some()
                && (mime.starts_with("text/")
                    || matches!(
                        mime.split(';').next().unwrap_or(""),
                        "application/javascript"
                            | "application/json"
                            | "application/wasm"
                            | "application/manifest+json"
                            | "image/svg+xml"
                    ))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::{Request, Response};
    use http_body_util::{BodyExt, Full};
    use std::{convert::Infallible, io::Read};
    use tower::{ServiceExt, service_fn};
    use tower_http::compression::Compression;

    const TEXT: &str = "const example = 'a repetitive static asset body for compression testing';\nconst example2 = 'a repetitive static asset body for compression testing';\n";

    async fn deliver(
        encoding: Option<&str>,
        range: bool,
        marked: bool,
        encoded: bool,
    ) -> (HeaderMap, Vec<u8>) {
        let service = service_fn(move |request: Request<Full<&'static [u8]>>| async move {
            let mut response = Response::builder()
                .header(header::CONTENT_TYPE, "application/javascript")
                .header(header::CONTENT_LENGTH, TEXT.len())
                .body(Full::new(TEXT.as_bytes()))
                .unwrap();
            if marked && allow_request(&request) {
                response.extensions_mut().insert(AssetResponse);
            }
            if encoded {
                response
                    .headers_mut()
                    .insert(header::CONTENT_ENCODING, "gzip".parse().unwrap());
            }
            Ok::<_, Infallible>(response)
        });
        let service = Compression::new(service)
            .gzip(true)
            .compress_when(predicate());
        let mut request = Request::new(Full::new(&b""[..]));
        if let Some(encoding) = encoding {
            request
                .headers_mut()
                .insert(header::ACCEPT_ENCODING, encoding.parse().unwrap());
        }
        if range {
            request
                .headers_mut()
                .insert(header::RANGE, "bytes=0-50".parse().unwrap());
        }
        let response = service.oneshot(request).await.unwrap();
        let (parts, body) = response.into_parts();
        (
            parts.headers,
            body.collect().await.unwrap().to_bytes().to_vec(),
        )
    }

    #[tokio::test]
    async fn gzip_assets_round_trip_and_vary() {
        let (headers, bytes) = deliver(Some("gzip"), false, true, false).await;
        assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
        assert!(!headers.contains_key(header::CONTENT_LENGTH));
        assert!(
            headers
                .get_all(header::VARY)
                .iter()
                .any(|v| v.to_str().unwrap().contains("accept-encoding"))
        );
        let mut decoded = String::new();
        flate2::read::GzDecoder::new(bytes.as_slice())
            .read_to_string(&mut decoded)
            .unwrap();
        assert_eq!(decoded, TEXT);
    }

    #[tokio::test]
    async fn negotiation_ranges_and_transports_remain_identity() {
        for encoding in [None, Some("gzip;q=0"), Some("br")] {
            let (headers, bytes) = deliver(encoding, false, true, false).await;
            assert!(!headers.contains_key(header::CONTENT_ENCODING));
            assert_eq!(bytes, TEXT.as_bytes());
        }
        for (range, marked) in [(true, true), (false, false)] {
            let (headers, bytes) = deliver(Some("gzip"), range, marked, false).await;
            assert!(!headers.contains_key(header::CONTENT_ENCODING));
            assert_eq!(bytes, TEXT.as_bytes());
        }
        let (_, bytes) = deliver(Some("gzip"), false, true, true).await;
        assert_eq!(
            bytes,
            TEXT.as_bytes(),
            "already encoded responses must not be encoded twice"
        );
        let request = Request::builder().method("HEAD").body(()).unwrap();
        assert!(!allow_request(&request));
    }
}
