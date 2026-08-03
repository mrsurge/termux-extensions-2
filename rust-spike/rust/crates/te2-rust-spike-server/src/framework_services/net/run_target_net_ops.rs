use axum::{
    Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tracing::warn;

use crate::{AppState, json_error};

const MAX_TUNNEL_MESSAGE_BYTES: usize = 1024 * 1024;
const TCP_READ_BYTES: usize = 64 * 1024;

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/api/run-targets/{ticket}/tunnel", get(open_tunnel))
}

async fn open_tunnel(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(ticket): Path<String>,
) -> Response {
    let Some(route) = state
        .service_scheduler()
        .run_targets()
        .resolve(&ticket)
        .await
    else {
        return json_error(
            StatusCode::NOT_FOUND,
            "Run target route is missing or expired",
        );
    };
    ws.max_message_size(MAX_TUNNEL_MESSAGE_BYTES)
        .on_upgrade(move |socket| bridge_run_target(socket, route.port))
        .into_response()
}

async fn bridge_run_target(socket: WebSocket, port: u16) {
    let upstream = match TcpStream::connect(("127.0.0.1", port)).await {
        Ok(stream) => stream,
        Err(error) => {
            warn!(%error, %port, "run target loopback connection failed");
            return;
        }
    };
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (mut tcp_read, mut tcp_write) = upstream.into_split();
    let mut buffer = vec![0_u8; TCP_READ_BYTES];

    loop {
        tokio::select! {
            read = tcp_read.read(&mut buffer) => {
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if ws_sink.send(Message::Binary(buffer[..count].to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
            message = ws_stream.next() => {
                match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        if tcp_write.write_all(&bytes).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Ping(bytes))) => {
                        if ws_sink.send(Message::Pong(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(_))) => break,
                }
            }
        }
    }
    let _ = tcp_write.shutdown().await;
    let _ = ws_sink.close().await;
}
