//! Opt-in read-only evidence, never production timing instrumentation.
use super::{
    git_ops::GitProviderRequest,
    history_sessions::{Owner, Request},
    scheduler::FrameworkServiceScheduler,
};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

fn request() -> Request {
    Request {
        version: 1,
        session_id: "history-benchmark".into(),
        limit: None,
        offset: None,
        commit_id: None,
        index: None,
    }
}

async fn baselines(scheduler: &FrameworkServiceScheduler, root: &str, path: &str) -> Vec<f64> {
    let mut samples = Vec::new();
    for _ in 0..40 {
        let start = Instant::now();
        let result = scheduler
            .git_head_blob(GitProviderRequest {
                root: Some(root.into()),
                relative_path: Some(path.into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(result.found, "benchmark path must exist in HEAD");
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        tokio::task::yield_now().await;
    }
    samples
}

fn summary(mut samples: Vec<f64>) -> Value {
    samples.sort_by(f64::total_cmp);
    json!({"samples": samples.len(), "medianMs": samples[samples.len()/2],
        "p95Ms": samples[(samples.len()*95).div_ceil(100)-1], "maxMs": samples.last()})
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "explicit read-only benchmark: set TE2_HISTORY_BENCH_ROOT and TE2_HISTORY_BENCH_PATH"]
async fn history_read_interference_benchmark() {
    let root = std::env::var("TE2_HISTORY_BENCH_ROOT").expect("explicit benchmark root");
    let path = std::env::var("TE2_HISTORY_BENCH_PATH").expect("explicit HEAD file path");
    let scheduler = Arc::new(FrameworkServiceScheduler::default());
    let owner = Owner {
        nid: 1100,
        name: "benchmark.history".into(),
        root: root.clone(),
        generation: Some(1),
    };
    let before = baselines(&scheduler, &root, &path).await;
    let started = Instant::now();
    let invalidated = Arc::new(AtomicBool::new(false));
    let flag = invalidated.clone();
    let opened = scheduler
        .history_sessions
        .dispatch_watched(
            "git.historyGraph.open",
            owner.clone(),
            request(),
            Some(Arc::new(move |_| {
                flag.store(true, Ordering::Release);
            })),
        )
        .await
        .unwrap();
    let open_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut page_request = request();
    page_request.offset = Some(0);
    page_request.limit = Some(100);
    let page_start = Instant::now();
    let page = scheduler
        .history_sessions
        .dispatch("git.historyGraph.next", owner.clone(), page_request)
        .await
        .unwrap();
    let first_page_ms = page_start.elapsed().as_secs_f64() * 1000.0;
    let commits: Vec<String> = page["page"]["commits"]
        .as_array()
        .unwrap()
        .iter()
        .take(10)
        .map(|row| row["id"].as_str().unwrap().to_owned())
        .collect();
    assert!(!commits.is_empty());
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let worker_scheduler = scheduler.clone();
    let worker_owner = owner.clone();
    let (ready, ready_rx) = tokio::sync::oneshot::channel();
    let background = tokio::spawn(async move {
        let mut pages = 0;
        let _ = ready.send(());
        let start = Instant::now();
        // Exercise the same bounded file-page work as the Python producer. No
        // unbounded soak or artificial sleep; finish a page already in flight.
        for commit in commits.iter().cycle().take(100) {
            let mut offset = 0;
            loop {
                let mut req = request();
                req.commit_id = Some(commit.clone());
                req.offset = Some(offset);
                req.limit = Some(40);
                let result = worker_scheduler
                    .history_sessions
                    .dispatch("git.historyGraph.files", worker_owner.clone(), req)
                    .await
                    .unwrap();
                pages += 1;
                if worker_stop.load(Ordering::Acquire) || pages >= 100 {
                    return (pages, start.elapsed().as_secs_f64() * 1000.0);
                }
                let Some(next) = result["page"]["nextOffset"].as_u64() else {
                    break;
                };
                offset = next as usize;
            }
        }
        (pages, start.elapsed().as_secs_f64() * 1000.0)
    });
    ready_rx.await.unwrap();
    let concurrent_start = Instant::now();
    let concurrent = baselines(&scheduler, &root, &path).await;
    let concurrent_ms = concurrent_start.elapsed().as_secs_f64() * 1000.0;
    stop.store(true, Ordering::Release);
    let (pages, background_ms) = background.await.unwrap();
    scheduler
        .history_sessions
        .dispatch("git.historyGraph.close", owner, request())
        .await
        .unwrap();
    let after = baselines(&scheduler, &root, &path).await;
    assert!(
        !invalidated.load(Ordering::Acquire),
        "repository refs changed during benchmark; rerun"
    );
    println!(
        "{}",
        json!({"benchmark": "history-read-interference", "root": root, "path": path,
        "snapshot": opened["snapshot"]["snapshotId"], "head": opened["snapshot"]["headId"],
        "historyOpenMs": open_ms, "first100PageMs": first_page_ms,
        "before": summary(before), "concurrent": summary(concurrent), "after": summary(after),
        "backgroundPages": pages, "backgroundMs": background_ms, "concurrentWindowMs": concurrent_ms,
        "scope": "native scheduler only; warmed caches; not end-to-end frontend file-open latency"})
    );
}
