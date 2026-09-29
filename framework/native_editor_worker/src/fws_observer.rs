//! FWS observer transport only. Domain decisions remain on Python's one loop.
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Condvar, Mutex, mpsc},
    thread,
    time::Duration,
};
use tf_rust_socketio::{ClientBuilder, Event, Payload, RawClient, TransportType};

const CAPACITY: usize = 256;
const BYTE_LIMIT: usize = 8 * 1024 * 1024;
const REQUEST_LIMIT: usize = 16;
type Reply = std::result::Result<Value, String>;

// Conservative retained-tree budget without a second JSON serialization just
// for measurement. Includes node/container overhead, not only text bytes.
fn weight(value: &Value) -> usize {
    match value {
        Value::String(text) => 32usize.saturating_add(text.len()),
        Value::Array(items) => items
            .iter()
            .fold(32usize, |sum, item| sum.saturating_add(weight(item))),
        Value::Object(items) => items.iter().fold(32usize, |sum, (key, item)| {
            sum.saturating_add(64)
                .saturating_add(key.len())
                .saturating_add(weight(item))
        }),
        _ => 32,
    }
}

#[derive(Default)]
struct Inner {
    epoch: u64,
    stopped: bool,
    broken: bool,
    socket: Option<RawClient>,
    events: VecDeque<(Value, usize)>,
    bytes: usize,
    next_request: u64,
    pending: HashMap<u64, mpsc::SyncSender<Reply>>,
}

#[derive(Default)]
struct Shared {
    inner: Mutex<Inner>,
    wake: Condvar,
}

impl Shared {
    fn invalidate(inner: &mut Inner, reason: &str) {
        inner.broken = true;
        inner.socket = None;
        inner.events.clear();
        inner.bytes = 0;
        for (_, reply) in inner.pending.drain() {
            let _ = reply.try_send(Err(reason.into()));
        }
        if !inner.stopped {
            inner.events.push_back((
                json!({"event":"disconnect", "epoch":inner.epoch, "data":reason}),
                0,
            ));
        }
    }

    fn fail(&self, epoch: u64, reason: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.epoch == epoch && !inner.stopped && !inner.broken {
            Self::invalidate(&mut inner, reason);
            self.wake.notify_all();
        }
    }

    fn push(inner: &mut Inner, event: Value) -> bool {
        let size = weight(&event);
        if inner.events.len() >= CAPACITY || size > BYTE_LIMIT.saturating_sub(inner.bytes) {
            Self::invalidate(inner, "FWS observer overflow; snapshot required");
            return false;
        }
        inner.bytes += size;
        inner.events.push_back((event, size));
        true
    }
}

#[derive(Default)]
pub struct Observer {
    session: Mutex<Option<Arc<Shared>>>,
}

fn payload_value(payload: Payload) -> Reply {
    match payload {
        Payload::Text(mut values, _) if values.len() == 1 => {
            let value = values.remove(0);
            if weight(&value) > BYTE_LIMIT {
                return Err("FWS event exceeds observer byte limit".into());
            }
            Ok(value)
        }
        _ => Err("FWS requires one JSON event argument".into()),
    }
}

fn ack_value(payload: Payload) -> Reply {
    // tf-rust-socketio wraps the entire wire acknowledgement argument array
    // as one Text value; event callbacks already expose individual arguments.
    match payload_value(payload)? {
        Value::Array(mut args) if args.len() == 1 => Ok(args.remove(0)),
        _ => Err("FWS acknowledgement requires one argument".into()),
    }
}

fn endpoint(url: &str) -> String {
    let url = url.trim_end_matches('/');
    if url.ends_with("/fws_ws/socket.io") {
        format!("{url}/")
    } else {
        format!("{url}/fws_ws/socket.io/")
    }
}

impl Observer {
    pub fn start(&self, url: String) -> Result<()> {
        ensure!(
            url.starts_with("http://") || url.starts_with("https://"),
            "invalid FWS URL"
        );
        let mut slot = self.session.lock().unwrap();
        ensure!(slot.is_none(), "FWS observer already started");
        let shared = Arc::new(Shared::default());
        let task = shared.clone();
        thread::Builder::new()
            .name("code-te2-fws-observer".into())
            .spawn(move || run(task, url))?;
        *slot = Some(shared);
        Ok(())
    }

    fn shared(&self) -> Result<Arc<Shared>> {
        self.session
            .lock()
            .unwrap()
            .clone()
            .context("FWS observer stopped")
    }

    pub fn read(&self) -> Result<Value> {
        let shared = self.shared()?;
        let mut inner = shared.inner.lock().unwrap();
        loop {
            if inner.stopped {
                return Ok(Value::Null);
            }
            if let Some((event, size)) = inner.events.pop_front() {
                inner.bytes -= size;
                return Ok(event);
            }
            inner = shared.wake.wait(inner).unwrap();
        }
    }

    pub fn call(&self, epoch: u64, request: Value) -> Result<Value> {
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        ensure!(
            matches!(method, "fws.dashboard.open" | "fws.logs.open"),
            "unsupported FWS observer method"
        );
        ensure!(weight(&request) <= 65536, "FWS request too large");
        let snapshot = method == "fws.dashboard.open";
        let shared = self.shared()?;
        let (tx, rx) = mpsc::sync_channel(1);
        let (id, socket) = {
            let mut inner = shared.inner.lock().unwrap();
            ensure!(
                !inner.stopped && !inner.broken && inner.epoch == epoch,
                "FWS generation disconnected"
            );
            let socket = inner.socket.clone().context("FWS namespace disconnected")?;
            ensure!(
                inner.pending.len() < REQUEST_LIMIT,
                "FWS request capacity exceeded"
            );
            inner.next_request += 1;
            let id = inner.next_request;
            inner.pending.insert(id, tx);
            (id, socket)
        };
        let callback_shared = shared.clone();
        let sent = socket.emit_with_ack(
            "fws_request",
            request,
            Duration::from_secs(10),
            move |payload, _| {
                let mut inner = callback_shared.inner.lock().unwrap();
                if inner.epoch != epoch || inner.stopped || inner.broken {
                    return;
                }
                if let Some(reply) = inner.pending.remove(&id) {
                    let mut value = ack_value(payload);
                    if snapshot && value.as_ref().is_ok_and(|v| v.get("error").is_none()) {
                        if !value
                            .as_ref()
                            .unwrap()
                            .pointer("/result/state/shells")
                            .is_some_and(Value::is_array)
                        {
                            value = Err("FWS snapshot missing authoritative shells".into());
                        }
                    }
                    // Preserve queued notifications: an acknowledgement is not
                    // a server revision fence. An event may have happened after
                    // snapshot capture but reached us before its acknowledgement.
                    let _ = reply.try_send(value);
                }
            },
        );
        if let Err(error) = sent {
            shared.inner.lock().unwrap().pending.remove(&id);
            bail!("FWS send failed: {error}");
        }
        let response = rx.recv_timeout(Duration::from_secs(10));
        let mut inner = shared.inner.lock().unwrap();
        inner.pending.remove(&id);
        ensure!(
            !inner.stopped && !inner.broken && inner.epoch == epoch,
            "FWS generation disconnected"
        );
        drop(inner);
        response
            .context("FWS acknowledgement timed out")?
            .map_err(anyhow::Error::msg)
    }

    pub fn reconnect(&self, epoch: u64) -> Result<()> {
        self.shared()?
            .fail(epoch, "FWS snapshot failed; reconnect required");
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(shared) = self.session.lock().unwrap().take() {
            let mut inner = shared.inner.lock().unwrap();
            inner.stopped = true;
            Shared::invalidate(&mut inner, "FWS observer stopped");
            shared.wake.notify_all();
        }
    }
}

impl Drop for Observer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(shared: Arc<Shared>, url: String) {
    loop {
        let epoch = {
            let mut inner = shared.inner.lock().unwrap();
            if inner.stopped {
                return;
            }
            inner.epoch += 1;
            inner.broken = false;
            inner.epoch
        };
        let connected = shared.clone();
        let notifications = shared.clone();
        let closed = shared.clone();
        let errors = shared.clone();
        let client = ClientBuilder::new(endpoint(&url))
            .namespace("/fws")
            .transport_type(TransportType::Websocket)
            .reconnect(false)
            .on(Event::Connect, move |_, socket| {
                let mut inner = connected.inner.lock().unwrap();
                if inner.stopped || inner.broken || inner.epoch != epoch {
                    return;
                }
                inner.socket = Some(socket);
                Shared::push(&mut inner, json!({"event":"connect", "epoch":epoch}));
                connected.wake.notify_all();
            })
            .on("fws_notification", move |payload, _| {
                match payload_value(payload) {
                    Ok(data) => {
                        let mut inner = notifications.inner.lock().unwrap();
                        if inner.stopped || inner.broken || inner.epoch != epoch {
                            return;
                        }
                        Shared::push(
                            &mut inner,
                            json!({"event":"notification", "epoch":epoch, "data":data}),
                        );
                        notifications.wake.notify_all();
                    }
                    Err(error) => notifications.fail(epoch, &error),
                }
            })
            .on("close", move |_, _| closed.fail(epoch, "FWS disconnected"))
            .on("error", move |_, _| {
                errors.fail(epoch, "FWS transport error")
            })
            .connect();
        match client {
            Ok(client) => {
                let inner = shared.inner.lock().unwrap();
                let (mut inner, timeout) = shared
                    .wake
                    .wait_timeout_while(inner, Duration::from_secs(5), |i| {
                        !i.stopped && !i.broken && i.socket.is_none()
                    })
                    .unwrap();
                if timeout.timed_out() && inner.socket.is_none() && !inner.stopped {
                    Shared::invalidate(&mut inner, "FWS namespace handshake timed out");
                    shared.wake.notify_all();
                }
                while !inner.stopped && !inner.broken {
                    inner = shared.wake.wait(inner).unwrap();
                }
                drop(inner);
                let _ = client.disconnect();
            }
            Err(error) => shared.fail(epoch, &format!("FWS connect failed: {error}")),
        }
        let inner = shared.inner.lock().unwrap();
        if inner.stopped {
            return;
        }
        // Only transport reconnection backs off. No shell/state polling.
        let _ = shared
            .wake
            .wait_timeout_while(inner, Duration::from_secs(1), |i| !i.stopped)
            .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_base_and_explicit_fws_urls() {
        assert_eq!(
            endpoint("http://127.0.0.1:8081"),
            "http://127.0.0.1:8081/fws_ws/socket.io/"
        );
        assert_eq!(
            endpoint("http://127.0.0.1:8081/fws_ws/socket.io/"),
            "http://127.0.0.1:8081/fws_ws/socket.io/"
        );
    }

    #[test]
    fn overflow_fences_generation_and_rejects_pending_calls() {
        let mut inner = Inner::default();
        inner.epoch = 1;
        let (tx, rx) = mpsc::sync_channel(1);
        inner.pending.insert(1, tx);
        for _ in 0..CAPACITY {
            assert!(Shared::push(&mut inner, json!({"event":"notification"})));
        }
        assert!(!Shared::push(&mut inner, json!({"event":"notification"})));
        assert!(inner.broken);
        assert!(rx.recv().unwrap().is_err());
        assert_eq!(inner.events.len(), 1);
        assert_eq!(inner.events[0].0["event"], "disconnect");
        assert_eq!(inner.bytes, 0);
        let mut byte_limited = Inner::default();
        assert!(!Shared::push(
            &mut byte_limited,
            Value::String("x".repeat(BYTE_LIMIT))
        ));
        assert!(byte_limited.broken);
        let shared = Shared {
            inner: Mutex::new(inner),
            wake: Condvar::new(),
        };
        shared.fail(0, "stale callback");
        assert_eq!(shared.inner.lock().unwrap().epoch, 1);
    }

    #[test]
    fn shutdown_releases_blocking_read_and_pending_ack() {
        let observer = Arc::new(Observer::default());
        let shared = Arc::new(Shared::default());
        let (tx, rx) = mpsc::sync_channel(1);
        shared.inner.lock().unwrap().pending.insert(1, tx);
        *observer.session.lock().unwrap() = Some(shared.clone());
        let read_shared = shared.clone();
        let reader = thread::spawn(move || {
            let mut inner = read_shared.inner.lock().unwrap();
            while !inner.stopped {
                inner = read_shared.wake.wait(inner).unwrap();
            }
        });
        observer.stop();
        reader.join().unwrap();
        assert!(rx.recv().unwrap().is_err());
        assert!(observer.read().is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_fws_snapshot_notifications_reconnect_and_stop() {
        use bytes::Bytes;
        use http_body_util::Full;
        use hyper::{
            Response,
            service::{Service, service_fn},
        };
        use hyper_util::{
            rt::{TokioExecutor, TokioIo},
            server::conn::auto::Builder,
        };
        use socketioxide::{
            SocketIo,
            extract::{AckSender, Data, SocketRef},
        };
        use std::convert::Infallible;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let inner =
            service_fn(|_| async { Ok::<_, Infallible>(Response::new(Full::new(Bytes::new()))) });
        let (service, io) = SocketIo::builder()
            .req_path("/fws_ws/socket.io")
            .build_with_inner_svc(inner);
        let (socket_tx, mut socket_rx) = tokio::sync::mpsc::channel(4);
        io.ns("/fws", move |socket: SocketRef| async move {
            let _ = socket_tx.try_send(socket.clone());
            socket.on(
                "fws_request",
                |socket: SocketRef, Data::<Value>(request), ack: AckSender| async move {
                    match request["method"].as_str().unwrap() {
                        "fws.dashboard.open" => {
                            socket
                                .emit("fws_notification", &json!({"method":"old"}))
                                .unwrap();
                            ack.send(&json!({"result":{"state":{"shells":[]}}}))
                                .unwrap();
                            socket
                                .emit("fws_notification", &json!({"method":"new"}))
                                .unwrap();
                        }
                        "fws.logs.open" => {
                            ack.send(&json!({"result":{}})).unwrap();
                        }
                        _ => unreachable!(),
                    }
                },
            );
        });
        let server = tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let service = service.clone();
                tokio::spawn(async move {
                    let wrapped = service_fn(move |request| service.call(request));
                    let _ = Builder::new(TokioExecutor::new())
                        .serve_connection_with_upgrades(TokioIo::new(stream), wrapped)
                        .await;
                });
            }
        });
        let observer = Arc::new(Observer::default());
        observer.start(url).unwrap();
        let reader = observer.clone();
        let first = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::task::spawn_blocking(move || reader.read()),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        assert_eq!(first["event"], "connect", "{first}");
        let epoch = first["epoch"].as_u64().unwrap();
        let caller = observer.clone();
        let result = tokio::task::spawn_blocking(move || {
            caller.call(epoch, json!({"method":"fws.dashboard.open"}))
        })
        .await
        .unwrap()
        .unwrap();
        assert!(result["result"]["state"]["shells"].is_array());
        let reader = observer.clone();
        let next = tokio::task::spawn_blocking(move || reader.read())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(next["data"]["method"], "old");
        let reader = observer.clone();
        let next = tokio::task::spawn_blocking(move || reader.read())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(next["data"]["method"], "new");
        socket_rx.recv().await.unwrap().disconnect().unwrap();
        let reader = observer.clone();
        let disconnected = tokio::task::spawn_blocking(move || reader.read())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(disconnected["event"], "disconnect");
        let reader = observer.clone();
        let connected = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::task::spawn_blocking(move || reader.read()),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        assert_eq!(connected["event"], "connect");
        assert!(connected["epoch"].as_u64().unwrap() > epoch);
        let next_epoch = connected["epoch"].as_u64().unwrap();
        let caller = observer.clone();
        let logs = tokio::task::spawn_blocking(move || {
            caller.call(next_epoch,
            json!({"method":"fws.logs.open", "params":{"shell_id":"terminal", "projection":true}}))
        })
        .await
        .unwrap()
        .unwrap();
        assert!(logs.get("result").is_some());
        assert!(
            observer
                .call(epoch, json!({"method":"fws.logs.open"}))
                .is_err()
        );
        observer.stop();
        io.close().await;
        server.abort();
    }
}
