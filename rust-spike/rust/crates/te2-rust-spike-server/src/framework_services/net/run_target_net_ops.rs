use axum::{
    Json, Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderValue, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use futures_util::{SinkExt, StreamExt, stream};
use std::{convert::Infallible, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::broadcast,
};
use tracing::warn;

use crate::{
    ApiResponse, AppState, framework_services::run_target_ops::RunTargetRouteProjection, json_error,
};

const MAX_TUNNEL_MESSAGE_BYTES: usize = 1024 * 1024;
const TCP_READ_BYTES: usize = 64 * 1024;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/run-targets/routes", get(list_routes))
        .route("/api/run-targets/events", get(route_events))
        .route("/api/run-targets/{ticket}/tunnel", get(open_tunnel))
}

async fn list_routes(State(state): State<AppState>) -> Response {
    let projection = state.service_scheduler().run_targets().list().await;
    no_store(Json(ApiResponse {
        ok: true,
        data: projection,
    }))
}

async fn route_events(State(state): State<AppState>) -> Response {
    let registry = state.service_scheduler().run_targets().clone();
    let (snapshot, receiver) = registry.subscribe().await;
    let initial = stream::once(async move {
        Ok::<Event, Infallible>(projection_event("run_target_routes_snapshot", &snapshot))
    });
    let updates = stream::unfold(
        (receiver, registry),
        |(mut receiver, registry)| async move {
            loop {
                match receiver.recv().await {
                    Ok(projection) => {
                        return Some((
                            Ok::<Event, Infallible>(projection_event(
                                "run_target_routes_changed",
                                &projection,
                            )),
                            (receiver, registry),
                        ));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let projection = registry.list().await;
                        return Some((
                            Ok::<Event, Infallible>(projection_event(
                                "run_target_routes_snapshot",
                                &projection,
                            )),
                            (receiver, registry),
                        ));
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );
    let response = Sse::new(initial.chain(updates))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(25))
                .text("ping"),
        )
        .into_response();
    no_store(response)
}

fn projection_event(name: &'static str, projection: &RunTargetRouteProjection) -> Event {
    Event::default()
        .event(name)
        .json_data(projection)
        .expect("run target projection must serialize")
}

fn no_store(response: impl IntoResponse) -> Response {
    let mut response = response.into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
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
