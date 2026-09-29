use crate::{
    Backend, State,
    protocol::{get, map, text},
    rpc_codec,
};
use anyhow::{Result, bail};
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, StreamBody, combinators::UnsyncBoxBody};
use hyper::{
    Request, Response, StatusCode,
    body::{Frame, Incoming},
    service::{Service, service_fn},
};
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto::Builder,
};
use rmpv::Value;
use socketioxide::{
    SocketIo,
    extract::{AckSender, Event, SocketRef, TryData},
    handler::ConnectHandler,
    socket::DisconnectReason,
};
use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::Ordering},
};
use tokio_util::io::ReaderStream;

type Body = UnsyncBoxBody<Bytes, std::io::Error>;
struct Entry {
    socket: SocketRef,
    ready: bool,
    rooms: HashSet<String>,
    pending: Vec<(String, Value)>,
}
#[derive(Default)]
pub struct Sockets {
    entries: Mutex<HashMap<(String, String), Entry>>,
}
impl Sockets {
    fn pending(&self, socket: SocketRef) {
        let sid = socket.id.to_string();
        self.entries.lock().unwrap().insert(
            (socket.ns().to_owned(), sid.clone()),
            Entry {
                socket,
                ready: false,
                rooms: HashSet::from([sid]),
                pending: Vec::new(),
            },
        );
    }
    fn ready(&self, socket: &SocketRef) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.get_mut(&(socket.ns().to_owned(), socket.id.to_string())) {
            entry.ready = true;
            for (event, value) in entry.pending.drain(..) {
                if let Err(error) = socket.emit(event, &value) {
                    eprintln!("[native-socket] queued emit failed: {error}");
                }
            }
        }
    }
    fn remove(&self, socket: &SocketRef) {
        self.entries
            .lock()
            .unwrap()
            .remove(&(socket.ns().to_owned(), socket.id.to_string()));
    }
    pub fn operation(&self, value: &Value) -> Result<()> {
        let namespace = text(value, "namespace").unwrap_or("/");
        let mut entries = self.entries.lock().unwrap();
        match text(value, "op") {
            Some("emit") => {
                let event = text(value, "event").ok_or_else(|| anyhow::anyhow!("missing event"))?;
                let data = get(value, "data").unwrap_or(&Value::Nil);
                // Encode once before room fan-out, never once per recipient.
                let encoded = if rpc_codec::encoded_event(namespace, event) {
                    Some(rpc_codec::encode(
                        data,
                        rpc_codec::lane(namespace).unwrap(),
                    )?)
                } else {
                    None
                };
                let data = encoded.as_ref().unwrap_or(data);
                let room = text(value, "room");
                let skip = text(value, "skipSid");
                for ((ns, sid), entry) in entries.iter_mut() {
                    if ns != namespace
                        || skip == Some(sid.as_str())
                        || room.is_some_and(|r| !entry.rooms.contains(r))
                    {
                        continue;
                    }
                    if entry.ready {
                        entry.socket.emit(event, data)?;
                    } else {
                        if entry.pending.len() >= 64 {
                            bail!("pending-connect emit queue full");
                        }
                        entry.pending.push((event.to_owned(), data.clone()));
                    }
                }
            }
            Some(op @ ("join" | "leave" | "disconnect")) => {
                let sid = text(value, "sid").unwrap_or("");
                if let Some(entry) = entries.get_mut(&(namespace.to_owned(), sid.to_owned())) {
                    let room = text(value, "room").unwrap_or("").to_owned();
                    match op {
                        "join" => {
                            entry.socket.join(room.clone());
                            entry.rooms.insert(room);
                        }
                        "leave" => {
                            entry.socket.leave(room.clone());
                            entry.rooms.remove(&room);
                        }
                        _ => {
                            entry.socket.clone().disconnect()?;
                        }
                    }
                }
            }
            _ => bail!("unknown native socket operation"),
        }
        Ok(())
    }
}

fn socket_event(socket: &SocketRef, event: &str, data: Value) -> Value {
    map([
        ("namespace", socket.ns().into()),
        ("sid", socket.id.to_string().into()),
        ("event", event.into()),
        ("data", data),
    ])
}

fn register(io: &SocketIo, backend: Backend, sockets: Arc<Sockets>, namespace: &'static str) {
    let middleware_backend = backend.clone();
    let middleware_sockets = sockets.clone();
    let connect = move |socket: SocketRef| {
        sockets.ready(&socket);
        let event_backend = backend.clone();
        socket.on_fallback(
            move |socket: SocketRef,
                  Event(event): Event,
                  TryData(data): TryData<Value>,
                  ack: AckSender| {
                let backend = event_backend.clone();
                async move {
                    let lane = rpc_codec::lane(namespace).filter(|_| event == "rpc");
                    let data = match (data, lane) {
                        (Ok(data), Some(lane)) => match rpc_codec::decode(data, lane) {
                            Ok(data) => Ok(data),
                            Err(message) => {
                                let error =
                                    rpc_codec::encode(&rpc_codec::parse_error(message), lane)
                                        .unwrap();
                                if namespace == "/rpc/editor" {
                                    let _ = socket.emit("rpc", &error);
                                } else {
                                    let _ = ack.send(&error);
                                }
                                return;
                            }
                        },
                        (data, _) => data.map_err(|e| e.to_string()),
                    };
                    let result = match data {
                        Ok(data) => {
                            backend
                                .call(socket_event(&socket, &event, data), false)
                                .await
                        }
                        Err(error) => Err(anyhow::anyhow!(error.to_string())),
                    };
                    if !socket.connected() {
                        return;
                    }
                    match result {
                        Ok(value) => {
                            let result = if let Some(lane) = lane.filter(|_| !value.is_nil()) {
                                rpc_codec::encode(&value, lane)
                            } else {
                                Ok(value)
                            };
                            match result {
                                Ok(value) => {
                                    let _ = ack.send(&value);
                                }
                                Err(error) => {
                                    eprintln!("[native-socket] ack encode failed: {error}");
                                    let _ = socket.disconnect();
                                }
                            }
                        }
                        Err(error) => {
                            eprintln!("[native-socket] {namespace}/{event}: {error}");
                            let _ = socket.disconnect();
                        }
                    }
                }
            },
        );
        let disconnect_backend = backend.clone();
        let disconnect_sockets = sockets.clone();
        socket.on_disconnect(move |socket: SocketRef, reason: DisconnectReason| {
            let backend = disconnect_backend.clone();
            let sockets = disconnect_sockets.clone();
            async move {
                sockets.remove(&socket);
                let mut value = socket_event(&socket, "disconnect", Value::Nil);
                if let Value::Map(fields) = &mut value {
                    fields.push(("reason".into(), format!("{reason:?}").into()));
                }
                if let Err(error) = backend.call(value, true).await {
                    eprintln!("[native-socket] disconnect cleanup: {error}");
                }
            }
        });
        std::future::ready(())
    };
    io.ns(
        namespace,
        connect.with(move |socket: SocketRef, TryData(auth): TryData<Value>| {
            let backend = middleware_backend.clone();
            let sockets = middleware_sockets.clone();
            async move {
                let auth = auth.map_err(|e| e.to_string())?;
                sockets.pending(socket.clone());
                let mut event = socket_event(&socket, "connect", Value::Nil);
                let Value::Map(fields) = &mut event else {
                    unreachable!()
                };
                fields.push(("auth".into(), auth));
                fields.push((
                    "environ".into(),
                    map([
                        (
                            "QUERY_STRING",
                            socket.req_parts().uri.query().unwrap_or("").into(),
                        ),
                        (
                            "HTTP_ORIGIN",
                            socket
                                .req_parts()
                                .headers
                                .get("origin")
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .into(),
                        ),
                    ]),
                ));
                match backend.call(event, true).await {
                    Ok(_) => Ok::<(), String>(()),
                    Err(error) => {
                        sockets.remove(&socket);
                        let _ = backend
                            .call(socket_event(&socket, "disconnect", Value::Nil), true)
                            .await;
                        Err(error.to_string())
                    }
                }
            }
        }),
    );
}

fn body(bytes: impl Into<Bytes>) -> Body {
    Full::new(bytes.into())
        .map_err(|never: Infallible| match never {})
        .boxed_unsync()
}
fn response(status: StatusCode, bytes: impl Into<Bytes>, mime: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", mime)
        .body(body(bytes))
        .unwrap()
}
fn error(status: StatusCode, detail: &str) -> Response<Body> {
    response(
        status,
        serde_json::json!({"detail": detail}).to_string(),
        "application/json",
    )
}

async fn file(
    base: &Path,
    relative: &str,
    head: bool,
    css_shim: bool,
    raw: bool,
) -> Response<Body> {
    let relative = match percent_encoding::percent_decode_str(relative).decode_utf8() {
        Ok(v) => v,
        Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid path"),
    };
    let base = match tokio::fs::canonicalize(base).await {
        Ok(v) => v,
        Err(_) => return error(StatusCode::NOT_FOUND, "File not found"),
    };
    let path = match tokio::fs::canonicalize(base.join(relative.as_ref())).await {
        Ok(v) if v.starts_with(&base) => v,
        _ => return error(StatusCode::NOT_FOUND, "File not found"),
    };
    let file = match tokio::fs::File::open(&path).await {
        Ok(v) => v,
        Err(_) => return error(StatusCode::NOT_FOUND, "File not found"),
    };
    let metadata = match file.metadata().await {
        Ok(v) if v.is_file() => v,
        _ => return error(StatusCode::NOT_FOUND, "File not found"),
    };
    if css_shim && path.extension().is_some_and(|v| v == "css") && !raw {
        let source = "const url=new URL(import.meta.url);url.searchParams.set('raw','1');const href=url.toString();const id='te2-css:'+href;if(!document.querySelector(`link[data-te2-css=\"${id}\"]`)){const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.te2Css=id;document.head.appendChild(link);}export default href;";
        let mut reply = response(
            StatusCode::OK,
            if head { "" } else { source },
            "application/javascript",
        );
        reply
            .headers_mut()
            .insert("content-length", source.len().into());
        return reply;
    }
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let data = if head {
        body(Bytes::new())
    } else {
        StreamBody::new(ReaderStream::new(file).map(|r| r.map(Frame::data))).boxed_unsync()
    };
    Response::builder()
        .header("content-type", mime.as_ref())
        .header("content-length", metadata.len())
        .body(data)
        .unwrap()
}

async fn http(
    request: Request<Incoming>,
    root: PathBuf,
    icons: PathBuf,
    backend: Backend,
) -> Response<Body> {
    let path = request.uri().path();
    let head = request.method() == hyper::Method::HEAD;
    let allow_head = path.starts_with("/ui/monaco_vscode/");
    if request.method() != hyper::Method::GET && !(head && allow_head) {
        let mut reply = error(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
        reply.headers_mut().insert(
            "allow",
            if allow_head { "GET, HEAD" } else { "GET" }
                .parse()
                .unwrap(),
        );
        return reply;
    }
    if path == "/" || path == "/status" {
        return response(
            StatusCode::OK,
            "{\"ok\":true,\"data\":{\"message\":\"File Editor CM6 app API ready\"}}",
            "application/json",
        );
    }
    let app = root.join("app/apps/code_te2");
    if path == "/__te2/runtime/loop" {
        return match backend.call(map([("kind", "loop".into())]), true).await {
            Ok(value) => response(
                StatusCode::OK,
                serde_json::to_vec(&value).unwrap(),
                "application/json",
            ),
            Err(_) => error(StatusCode::SERVICE_UNAVAILABLE, "Domain loop unavailable"),
        };
    }
    let raw = request
        .uri()
        .query()
        .unwrap_or("")
        .split('&')
        .any(|v| v == "raw=1");
    for (prefix, base, css) in [
        ("/static/", app.join("static"), false),
        ("/agent_icons/", icons, false),
        (
            "/ui/monaco_vscode/esm/",
            root.join("app/static/vendor/monaco-editor-core/esm"),
            true,
        ),
        (
            "/ui/monaco_vscode/lang/",
            root.join("app/static/vendor/monaco-editor-core/te2-lang"),
            true,
        ),
        (
            "/ui/monaco_editor/themes/",
            app.join("monaco_editor/themes"),
            false,
        ),
        (
            "/ui/monaco_editor/textmate/",
            app.join("monaco_editor/textmate"),
            false,
        ),
    ] {
        if let Some(relative) = path.strip_prefix(prefix) {
            return file(&base, relative, head, css, raw).await;
        }
    }
    if let Some(rest) = path.strip_prefix("/ui/monaco_editor/cs_themes/") {
        if let Some((extension, file)) = rest.split_once('/') {
            let request = map([
                ("kind", "theme".into()),
                ("extension", extension.into()),
                ("file", file.into()),
            ]);
            if let Ok(value) = backend.call(request, false).await {
                if !value.is_nil() {
                    if let Ok(text) = serde_json::to_string(&value) {
                        return response(StatusCode::OK, text, "application/json");
                    }
                }
            }
        }
    }
    error(StatusCode::NOT_FOUND, "Not Found")
}

pub async fn serve(
    listener: tokio::net::TcpListener,
    backend: Backend,
    sockets: Arc<Sockets>,
    root: PathBuf,
    icons: PathBuf,
    state: Arc<State>,
) -> Result<()> {
    let http_backend = backend.clone();
    let inner = service_fn(move |request| {
        let root = root.clone();
        let icons = icons.clone();
        let backend = http_backend.clone();
        async move { Ok::<_, Infallible>(http(request, root, icons, backend).await) }
    });
    let (service, io) = SocketIo::builder()
        .max_payload(8 * 1024 * 1024)
        .max_buffer_size(128)
        .build_with_inner_svc(inner);
    for namespace in [
        "/rpc/editor",
        "/rpc/explorer",
        "/ui_ipc",
        "/sidebar_ipc",
        "/terminal",
    ] {
        register(&io, backend.clone(), sockets.clone(), namespace);
    }
    let mut connections = tokio::task::JoinSet::new();
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    loop {
        if state.closed.load(Ordering::Acquire) {
            break;
        }
        tokio::select! {
            _ = state.wake.notified() => break,
            _ = term.recv() => break,
            _ = tokio::signal::ctrl_c() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let service = service.clone();
                connections.spawn(async move {
                    let wrapped = service_fn(move |mut request: Request<Incoming>| {
                        let service = service.clone();
                        // Keep canonical and historical physical paths on one gateway.
                        for alias in ["/editor_ws/socket.io", "/explorer_ws/socket.io", "/ui_ipc_ws/socket.io", "/terminal_ws/socket.io"] {
                            if request.uri().path() == alias || request.uri().path().starts_with(&format!("{alias}/")) {
                                let mut parts = request.uri().clone().into_parts();
                                let path = format!("/socket.io/{}", request.uri().query().map(|q| format!("?{q}")).unwrap_or_default());
                                parts.path_and_query = Some(path.parse().unwrap());
                                *request.uri_mut() = hyper::Uri::from_parts(parts).unwrap(); break;
                            }
                        }
                        let origin = request.headers().get("origin").cloned();
                        async move {
                            let preflight = request.method() == hyper::Method::OPTIONS && origin.is_some();
                            let requested_headers = request.headers().get("access-control-request-headers").cloned();
                            let mut response = if preflight {
                                response(StatusCode::NO_CONTENT, Bytes::new(), "text/plain")
                            } else {
                                service.call(request).await?.map(BodyExt::boxed_unsync)
                            };
                            if let Some(origin) = origin {
                                response.headers_mut().insert("access-control-allow-origin", origin);
                                response.headers_mut().insert("access-control-allow-credentials", "true".parse().unwrap());
                                response.headers_mut().insert("vary", "Origin".parse().unwrap());
                                if preflight {
                                    response.headers_mut().insert("access-control-allow-methods", "GET, HEAD, POST, OPTIONS".parse().unwrap());
                                    if let Some(headers) = requested_headers {
                                        response.headers_mut().insert("access-control-allow-headers", headers);
                                    }
                                }
                            }
                            Ok::<_, Infallible>(response)
                        }
                    });
                    if let Err(error) = Builder::new(TokioExecutor::new()).serve_connection_with_upgrades(TokioIo::new(stream), wrapped).await {
                        eprintln!("[native-http] connection ended: {error}");
                    }
                });
            }
        }
    }
    io.close().await;
    connections.abort_all();
    Ok(())
}
