//! Isolated await-completion probe; does not link or import the TE2 runtime.
use anyhow::{Result, ensure};
use pyo3::{prelude::*, types::PyModule};
use pyo3_async_runtimes::TaskLocals;
use std::{
    ffi::CString,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Instant,
};
use tokio::sync::{Semaphore, oneshot};

#[derive(Default)]
struct Occupancy {
    active: AtomicUsize,
    peak: AtomicUsize,
}
struct Busy(Arc<Occupancy>);
impl Busy {
    fn enter(state: Arc<Occupancy>) -> Self {
        let active = state.active.fetch_add(1, Ordering::SeqCst) + 1;
        state.peak.fetch_max(active, Ordering::SeqCst);
        Self(state)
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Clone)]
struct Domain {
    module: Arc<Py<PyModule>>,
    locals: Arc<TaskLocals>,
}
impl Domain {
    fn start(module: Arc<Py<PyModule>>, uvloop: bool) -> Result<Self> {
        let locals = Python::attach(|py| -> PyResult<TaskLocals> {
            let event_loop = module.call_method1(py, "start", (uvloop,))?;
            Ok(TaskLocals::new(event_loop.into_bound(py)).copy_context(py)?)
        })?;
        Ok(Self {
            module,
            locals: Arc::new(locals),
        })
    }

    async fn request(
        &self,
        bridge: bool,
        delay: f64,
        fail: bool,
        timeout: f64,
        admission: Arc<Semaphore>,
        occupancy: Arc<Occupancy>,
    ) -> Result<(String, bool)> {
        let permit = admission.try_acquire_owned()?;
        let this = self.clone();
        let (tx, rx) = oneshot::channel();
        // Owned driver keeps admission after the caller disappears. This is a
        // PROBE design, not proof that simply replacing result() is safe.
        tokio::spawn(async move {
            let _permit = permit;
            let answer: Result<(String, bool)> = async {
                if !bridge {
                    return tokio::task::spawn_blocking(move || {
                        let _busy = Busy::enter(occupancy);
                        Python::attach(|py| -> PyResult<(String, bool)> {
                            let future = this.module.call_method1(py, "submit", (delay, fail))?;
                            let answer = future.call_method1(py, "result", (timeout,));
                            if answer.is_err() {
                                future.call_method0(py, "cancel")?;
                            }
                            answer?.extract(py)
                        })
                        .map_err(Into::into)
                    })
                    .await?;
                }
                let module = this.module.clone();
                let locals = this.locals.clone();
                let (waiting, original) = tokio::task::spawn_blocking(move || {
                    let _busy = Busy::enter(occupancy);
                    Python::attach(|py| -> PyResult<_> {
                        ensure_open(py, &locals)?;
                        let future = module.call_method1(py, "submit", (delay, fail))?;
                        let awaitable = module.call_method1(py, "adapt", (future.bind(py),))?;
                        let waiting = pyo3_async_runtimes::into_future_with_locals(
                            &locals,
                            awaitable.into_bound(py),
                        )?;
                        Ok((waiting, future))
                    })
                })
                .await??;
                tokio::pin!(waiting);
                let answer =
                    tokio::time::timeout(std::time::Duration::from_secs_f64(timeout), &mut waiting)
                        .await;
                match answer {
                    Ok(result) => {
                        let result = result?;
                        // Preserve bounded blocking result marshalling too.
                        Ok(tokio::task::spawn_blocking(move || {
                            Python::attach(|py| result.extract(py))
                        })
                        .await??)
                    }
                    Err(_) => {
                        Python::attach(|py| original.call_method0(py, "cancel"))?;
                        anyhow::bail!("synthetic deadline");
                    }
                }
            }
            .await;
            let _ = tx.send(answer);
        });
        rx.await?
    }
    fn stats(&self) -> Result<(usize, usize, usize)> {
        Ok(Python::attach(|py| {
            self.module.call_method0(py, "stats")?.extract(py)
        })?)
    }
    fn stop(&self) -> Result<()> {
        Python::attach(|py| self.module.call_method0(py, "stop"))?;
        Ok(())
    }
}
fn ensure_open(py: Python<'_>, locals: &TaskLocals) -> PyResult<()> {
    if locals
        .event_loop(py)
        .call_method0("is_closed")?
        .is_truthy()?
    {
        return Err(pyo3::exceptions::PyRuntimeError::new_err(
            "stale domain loop",
        ));
    }
    Ok(())
}

async fn run(module: Arc<Py<PyModule>>) -> Result<()> {
    for uvloop in [false, true] {
        let domain = Domain::start(module.clone(), uvloop)?;
        for bridge in [false, true] {
            let admission = Arc::new(Semaphore::new(64));
            let occupancy = Arc::new(Occupancy::default());
            let result = domain
                .request(
                    bridge,
                    0.001,
                    false,
                    2.0,
                    admission.clone(),
                    occupancy.clone(),
                )
                .await?;
            ensure!(
                result == ("probe-context".to_owned(), true),
                "context/owning loop mismatch"
            );
            ensure!(
                domain
                    .request(
                        bridge,
                        0.001,
                        true,
                        2.0,
                        admission.clone(),
                        occupancy.clone()
                    )
                    .await
                    .is_err()
            );
            ensure!(
                domain
                    .request(
                        bridge,
                        0.1,
                        false,
                        0.01,
                        admission.clone(),
                        occupancy.clone()
                    )
                    .await
                    .is_err()
            );
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            let prior = domain.stats()?;
            let copy = domain.clone();
            let a = admission.clone();
            let o = occupancy.clone();
            let caller =
                tokio::spawn(async move { copy.request(bridge, 0.15, false, 2.0, a, o).await });
            for _ in 0..100 {
                if domain.stats()?.0 > prior.0 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
            ensure!(domain.stats()?.0 == prior.0 + 1, "request not started");
            caller.abort();
            let _ = caller.await;
            ensure!(
                admission.available_permits() == 63,
                "cancel released accepted work early"
            );
            tokio::time::sleep(std::time::Duration::from_millis(180)).await;
            ensure!(admission.available_permits() == 64);
            ensure!(domain.stats()?.1 == prior.1 + 1);
            ensure!(
                domain.stats()?.2 == prior.2,
                "caller drop cancelled accepted work"
            );
            let single = Arc::new(Semaphore::new(1));
            let d = domain.clone();
            let a = single.clone();
            let occupied =
                tokio::spawn(
                    async move { d.request(bridge, 0.1, false, 2.0, a, Arc::default()).await },
                );
            for _ in 0..100 {
                if single.available_permits() == 0 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
            ensure!(single.available_permits() == 0);
            ensure!(
                domain
                    .request(bridge, 0.0, false, 2.0, single.clone(), Arc::default())
                    .await
                    .is_err(),
                "overload was not rejected"
            );
            occupied.await??;
            ensure!(single.available_permits() == 1);
            println!(
                "{}",
                serde_json::json!({"kind":"parity", "uvloop":uvloop, "bridge":bridge,
                "overload":"pass",
                "context_loop_exception_deadline_caller_drop_permits":"pass"})
            );
        }
        for concurrency in [1, 16, 64] {
            for delay in [0.0, 0.02] {
                // Alternate ordering between samples; keep the production cap.
                for sample in 0..5 {
                    for offset in 0..2 {
                        let bridge = (sample + offset) % 2 == 1;
                        let admission = Arc::new(Semaphore::new(64));
                        let occupancy = Arc::new(Occupancy::default());
                        let start = Instant::now();
                        let mut tasks = Vec::new();
                        for _ in 0..concurrency {
                            let d = domain.clone();
                            let a = admission.clone();
                            let o = occupancy.clone();
                            tasks.push(tokio::spawn(async move {
                                let begin = Instant::now();
                                let value = d.request(bridge, delay, false, 2.0, a, o).await?;
                                ensure!(value.1);
                                Ok::<_, anyhow::Error>(begin.elapsed().as_secs_f64() * 1000.0)
                            }));
                        }
                        let midpoint = if delay > 0.0 {
                            tokio::time::sleep(std::time::Duration::from_secs_f64(delay / 2.0))
                                .await;
                            Some(occupancy.active.load(Ordering::SeqCst))
                        } else {
                            None
                        };
                        let mut latency = Vec::new();
                        for task in tasks {
                            latency.push(task.await??);
                        }
                        latency.sort_by(f64::total_cmp);
                        println!(
                            "{}",
                            serde_json::json!({"kind":"timing", "uvloop":uvloop,
                            "bridge":bridge, "sample":sample, "concurrency":concurrency, "delay_ms":delay*1000.0,
                            "elapsed_ms":start.elapsed().as_secs_f64()*1000.0,
                            "p95_request_ms":latency[(latency.len()*95).div_ceil(100)-1],
                            "blocking_sections_mid_delay":midpoint,
                            "peak_blocking_sections":occupancy.peak.load(Ordering::SeqCst)})
                        );
                    }
                }
            }
        }
        // Shutdown cancels actual pending tasks and terminates the owning loop.
        let admission = Arc::new(Semaphore::new(64));
        let d = domain.clone();
        let a = admission.clone();
        let pending =
            tokio::spawn(async move { d.request(true, 60.0, false, 2.0, a, Arc::default()).await });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        let closing = domain.clone();
        tokio::task::spawn_blocking(move || closing.stop()).await??;
        ensure!(pending.await?.is_err(), "shutdown lost pending result");
        ensure!(admission.available_permits() == 64);
        let stale = Python::attach(|py| ensure_open(py, &domain.locals));
        ensure!(stale.is_err());
        println!(
            "{}",
            serde_json::json!({"kind":"lifecycle", "uvloop":uvloop,
            "shutdown_pending_stale_loop":"pass"})
        );
    }
    Ok(())
}

fn main() -> Result<()> {
    Python::initialize();
    let module = Python::attach(|py| -> PyResult<_> {
        let module = if let Ok(directory) = std::env::var("TE2_PROBE_BRIDGE_DIR") {
            py.import("sys")?
                .getattr("path")?
                .call_method1("insert", (0, directory))?;
            py.import("bridge_fixture")?
        } else {
            let code = CString::new(include_str!("../bridge_fixture.py")).unwrap();
            PyModule::from_code(py, &code, c"bridge_fixture.py", c"bridge_fixture")?
        };
        eprintln!("fixture={}", module.getattr("__file__")?);
        module
            .getattr("request_context")?
            .call_method1("set", ("probe-context",))?;
        Ok(Arc::new(module.unbind()))
    })?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .max_blocking_threads(128)
        .enable_all()
        .build()?;
    let result = runtime.block_on(run(module.clone()));
    Python::attach(|py| module.call_method0(py, "stop"))?;
    result
}
