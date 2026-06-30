#![allow(dead_code)] // Staged pipe protocol surface; runtime shell wiring follows later.

mod fs_pipe_ops;
mod git_pipe_ops;
pub(crate) mod protocol;
mod search_pipe_ops;

use std::sync::Arc;

use crate::framework_services::scheduler::FrameworkServiceScheduler;
use protocol::{PipeEnvelope, PipeError, PipeIdentity, PipeMessageKind};

pub(crate) trait PipeEventSink: Send + Sync {
    fn send(&self, envelope: PipeEnvelope) -> anyhow::Result<()>;
}

pub(crate) async fn dispatch_request(
    request: PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
) -> PipeEnvelope {
    if !matches!(request.kind, PipeMessageKind::Request) {
        return PipeEnvelope::error_response(
            &request,
            responder,
            PipeError::new(
                "protocol.expectedRequest",
                "pipe dispatcher only accepts request envelopes",
                false,
                None,
            ),
        );
    }

    if let Some(response) = fs_pipe_ops::dispatch_fs_request(&request, responder, scheduler).await {
        return response;
    }
    if let Some(response) =
        git_pipe_ops::dispatch_git_request(&request, responder, scheduler, event_sink.clone()).await
    {
        return response;
    }
    // Search provider dispatch stays on the shared pipe router so app workers
    // call framework-owned search exactly like fs/git services.
    if let Some(response) =
        search_pipe_ops::dispatch_search_request(&request, responder, scheduler, event_sink).await
    {
        return response;
    }

    PipeEnvelope::error_response(
        &request,
        responder,
        PipeError::new(
            "protocol.methodNotFound",
            format!(
                "Method not found: {}",
                request.method.as_deref().unwrap_or("<missing>")
            ),
            false,
            None,
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework_services::common::path_to_string;
    use git2::{IndexAddOption, Signature};
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    use tokio::time::{Duration, sleep};

    #[derive(Default)]
    struct TestSink {
        frames: Mutex<Vec<PipeEnvelope>>,
    }

    impl PipeEventSink for TestSink {
        fn send(&self, envelope: PipeEnvelope) -> anyhow::Result<()> {
            self.frames.lock().expect("frames lock").push(envelope);
            Ok(())
        }
    }

    fn test_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("te2-rust-spike-pipe-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn request(method: &str, params: serde_json::Value, root: &std::path::Path) -> PipeEnvelope {
        PipeEnvelope {
            jsonrpc: protocol::JSONRPC_VERSION.to_owned(),
            protocol_version: protocol::PROTOCOL_VERSION,
            kind: PipeMessageKind::Request,
            id: Some("req-1".to_owned()),
            method: Some(method.to_owned()),
            origin_nid: 1100,
            origin_name: "file_editor_cm6.explorer".to_owned(),
            target_nid: Some(2100),
            target_name: Some("service.fs".to_owned()),
            project_generation: Some(7),
            workspace_root: Some(path_to_string(root)),
            correlation_id: Some("test-correlation".to_owned()),
            op_id: Some("op-1".to_owned()),
            sequence: Some(1),
            params: Some(params),
            result: None,
            error: None,
            reason: None,
        }
    }

    fn targeted_request(
        method: &str,
        params: serde_json::Value,
        root: &std::path::Path,
        target_nid: u32,
        target_name: &str,
    ) -> PipeEnvelope {
        PipeEnvelope {
            target_nid: Some(target_nid),
            target_name: Some(target_name.to_owned()),
            ..request(method, params, root)
        }
    }

    fn commit_all(repo: &git2::Repository, message: &str) {
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_oid = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_oid).expect("tree");
        let sig = Signature::now("TE2 Test", "te2@example.invalid").expect("signature");
        let parents = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .and_then(|oid| repo.find_commit(oid).ok())
            .map(|parent| vec![parent])
            .unwrap_or_default();
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .expect("commit");
    }

    async fn dispatch_git(
        method: &str,
        params: serde_json::Value,
        root: &std::path::Path,
    ) -> serde_json::Value {
        let response = dispatch_request(
            targeted_request(method, params, root, 2200, "service.git"),
            &PipeIdentity {
                nid: 2200,
                name: "service.git".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;
        assert_eq!(response.kind, PipeMessageKind::Response);
        response.result.expect("response result")
    }

    async fn dispatch_git_envelope(
        method: &str,
        params: serde_json::Value,
        root: &std::path::Path,
        event_sink: Option<Arc<dyn PipeEventSink>>,
    ) -> PipeEnvelope {
        dispatch_request(
            targeted_request(method, params, root, 2200, "service.git"),
            &PipeIdentity {
                nid: 2200,
                name: "service.git".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            event_sink,
        )
        .await
    }

    #[tokio::test]
    async fn line_codec_round_trips_request_envelope() {
        let root = test_root("codec");
        let envelope = request("fs.listDirectory", json!({ "path": "." }), &root);
        let encoded = protocol::encode_line(&envelope).expect("encode line");
        assert!(encoded.ends_with('\n'));

        let decoded = protocol::decode_line(&encoded).expect("decode line");
        assert_eq!(decoded.jsonrpc, "2.0");
        assert_eq!(decoded.protocol_version, 1);
        assert_eq!(decoded.kind, PipeMessageKind::Request);
        assert_eq!(decoded.method.as_deref(), Some("fs.listDirectory"));

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_fs_list_directory_to_contract_dto() {
        let root = test_root("dispatch");
        fs::write(root.join("main.py"), "print('hello')\n").expect("write file");

        let response = dispatch_request(
            request("fs.listDirectory", json!({ "path": "." }), &root),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        assert_eq!(response.id.as_deref(), Some("req-1"));
        let result = response.result.expect("response result");
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("FsDirectoryListing")
        );
        assert_eq!(
            result
                .get("projectGeneration")
                .and_then(|value| value.as_u64()),
            Some(7)
        );
        let entries = result
            .get("entries")
            .and_then(|value| value.as_array())
            .expect("entries");
        assert_eq!(
            entries[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("main.py")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_fs_mutations_to_contract_dtos() {
        let root = test_root("fs-mutations");
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::create_dir_all(root.join("dest")).expect("create dest");

        let created_file = dispatch_request(
            request(
                "fs.createFile",
                json!({ "parentRel": "src", "name": "main.py" }),
                &root,
            ),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;
        assert_eq!(created_file.kind, PipeMessageKind::Response);
        assert_eq!(
            created_file
                .result
                .as_ref()
                .and_then(|result| result.get("dto"))
                .and_then(|value| value.as_str()),
            Some("FsMutationResult")
        );
        assert!(root.join("src/main.py").is_file());

        let renamed = dispatch_request(
            request(
                "fs.rename",
                json!({ "path": "src/main.py", "newName": "renamed.py" }),
                &root,
            ),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;
        assert_eq!(renamed.kind, PipeMessageKind::Response);
        assert!(root.join("src/renamed.py").is_file());

        let copied = dispatch_request(
            request(
                "fs.copy",
                json!({ "path": "src/renamed.py", "destination": "dest" }),
                &root,
            ),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;
        assert_eq!(copied.kind, PipeMessageKind::Response);
        assert!(root.join("dest/renamed.py").is_file());

        let deleted = dispatch_request(
            request("fs.delete", json!({ "path": "dest/renamed.py" }), &root),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;
        assert_eq!(deleted.kind, PipeMessageKind::Response);
        assert!(!root.join("dest/renamed.py").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_search_files_to_contract_dto() {
        let root = test_root("search-files");
        fs::create_dir_all(root.join("src/editor")).expect("create editor dir");
        fs::create_dir_all(root.join(".hidden")).expect("create hidden dir");
        fs::create_dir_all(root.join("node_modules")).expect("create node modules");
        fs::write(root.join("src/editor/main.rs"), "fn main() {}\n").expect("write source");
        fs::write(root.join(".hidden/editor.log"), "hidden\n").expect("write hidden");
        fs::write(root.join("node_modules/editor.js"), "ignored\n").expect("write ignored");

        let response = dispatch_request(
            targeted_request(
                "search.files.get",
                json!({
                    "query": "editor",
                    "maxResults": 10,
                    "includeHidden": false,
                    "useIgnoreFiles": true,
                    "excludePatterns": ["node_modules/**"]
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let result = response.result.expect("response result");
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("SearchFilesResult")
        );
        let items = result
            .get("items")
            .and_then(|value| value.as_array())
            .expect("items");
        assert!(
            items.iter().any(|item| {
                item.get("relativePath").and_then(|value| value.as_str()) == Some("src/editor")
                    && item.get("kind").and_then(|value| value.as_str()) == Some("dir")
            }),
            "expected src/editor directory in {items:?}"
        );
        assert!(
            !items.iter().any(|item| item
                .get("relativePath")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .contains("node_modules")),
            "node_modules result leaked into {items:?}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_search_content_to_contract_dto() {
        let root = test_root("search-content");
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::create_dir_all(root.join("docs")).expect("create docs");
        fs::write(
            root.join("src/open.ts"),
            "const value = 1;\nexport function openFile(path: string) {}\n",
        )
        .expect("write source");
        fs::write(root.join("docs/open.txt"), "function openFile docs\n").expect("write docs");

        let response = dispatch_request(
            targeted_request(
                "search.content.get",
                json!({
                    "query": "function openFile",
                    "isRegex": false,
                    "isCaseSensitive": true,
                    "includePatterns": ["*.ts"],
                    "maxFiles": 10,
                    "maxMatchesPerFile": 5,
                    "contextChars": 75
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let result = response.result.expect("response result");
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("SearchContentResult")
        );
        assert_eq!(
            result.get("fileCount").and_then(|value| value.as_u64()),
            Some(1)
        );
        assert_eq!(
            result.get("matchCount").and_then(|value| value.as_u64()),
            Some(1)
        );
        let first_match = result["files"][0]["matches"][0].as_object().expect("match");
        assert_eq!(
            first_match
                .get("lineNumber")
                .and_then(|value| value.as_u64()),
            Some(2)
        );
        assert_eq!(
            first_match
                .get("columnNumber")
                .and_then(|value| value.as_u64()),
            Some(8)
        );
        assert_eq!(
            first_match
                .get("matchText")
                .and_then(|value| value.as_str()),
            Some("function openFile")
        );
        assert_eq!(
            first_match
                .get("lineRanges")
                .and_then(|value| value.as_array())
                .and_then(|ranges| ranges.first())
                .and_then(|range| range.get("start"))
                .and_then(|value| value.as_u64()),
            Some(7)
        );
        assert_eq!(
            first_match
                .get("snippetRanges")
                .and_then(|value| value.as_array())
                .and_then(|ranges| ranges.first())
                .and_then(|range| range.get("end"))
                .and_then(|value| value.as_u64()),
            Some(24)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_search_content_invalid_regex_as_pipe_error() {
        let root = test_root("search-invalid-regex");
        fs::write(root.join("main.rs"), "fn main() {}\n").expect("write source");

        let response = dispatch_request(
            targeted_request(
                "search.content.get",
                json!({
                    "query": "[",
                    "isRegex": true
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Error);
        assert_eq!(
            response.error.as_ref().map(|error| error.code.as_str()),
            Some("search.invalidRegex")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn search_content_has_no_hidden_file_cap() {
        let root = test_root("search-no-hidden-cap");
        for index in 0..55 {
            fs::write(root.join(format!("match_{index}.txt")), "needle\n")
                .expect("write match file");
        }

        let response = dispatch_request(
            targeted_request(
                "search.content.get",
                json!({
                    "dto": "SearchContentRequest",
                    "version": 1,
                    "query": "needle",
                    "isCaseSensitive": true
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let result = response.result.expect("response result");
        assert_eq!(
            result.get("fileCount").and_then(|value| value.as_u64()),
            Some(55)
        );
        assert_eq!(
            result.get("matchCount").and_then(|value| value.as_u64()),
            Some(55)
        );
        assert_eq!(
            result.get("truncated").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            result.get("complete").and_then(|value| value.as_bool()),
            Some(true)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn search_request_metadata_mismatch_is_typed_error() {
        let root = test_root("search-metadata");
        fs::write(root.join("main.rs"), "fn main() {}\n").expect("write source");

        let response = dispatch_request(
            targeted_request(
                "search.content.get",
                json!({
                    "dto": "WrongDto",
                    "version": 1,
                    "query": "main"
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Error);
        assert_eq!(
            response.error.as_ref().map(|error| error.code.as_str()),
            Some("search.invalidRequest")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_search_content_start_and_routes_result_notifications() {
        let root = test_root("search-progressive");
        for index in 0..20 {
            fs::write(root.join(format!("{index:02}.txt")), "needle\n").expect("write hit");
        }
        let scheduler = FrameworkServiceScheduler::default();
        let sink = Arc::new(TestSink::default());

        let response = dispatch_request(
            targeted_request(
                "search.content.start",
                json!({
                    "dto": "SearchContentStartRequest",
                    "version": 1,
                    "query": "needle",
                    "isCaseSensitive": true,
                    "correlationId": "search-correlation",
                    "presentationWindow": {
                        "maxInitialMatchesPerFile": 10,
                        "maxInitialMatchesTotal": 2
                    }
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &scheduler,
            Some(sink.clone()),
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let started = response.result.expect("start result");
        assert_eq!(
            started.get("dto").and_then(|value| value.as_str()),
            Some("SearchJobStarted")
        );
        let search_id = started
            .get("searchId")
            .and_then(|value| value.as_str())
            .expect("search id")
            .to_owned();

        let mut result_frame = None;
        let mut done_frame = None;
        for _ in 0..100 {
            {
                let frames = sink.frames.lock().expect("frames lock");
                result_frame = frames
                    .iter()
                    .find(|frame| frame.method.as_deref() == Some("search.job.result"))
                    .cloned();
                done_frame = frames
                    .iter()
                    .find(|frame| frame.method.as_deref() == Some("search.job.done"))
                    .cloned();
            }
            if result_frame.is_some() && done_frame.is_some() {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }

        let result_frame = result_frame.expect("search result notification");
        assert_eq!(result_frame.kind, PipeMessageKind::Notification);
        assert_eq!(result_frame.target_nid, Some(1100));
        assert_eq!(
            result_frame.target_name.as_deref(),
            Some("file_editor_cm6.explorer")
        );
        let result_params = result_frame.params.expect("result params");
        assert_eq!(
            result_params.get("dto").and_then(|value| value.as_str()),
            Some("SearchJobResult")
        );
        assert_eq!(
            result_params
                .get("searchId")
                .and_then(|value| value.as_str()),
            Some(search_id.as_str())
        );
        assert_eq!(
            result_params
                .get("result")
                .and_then(|value| value.get("dto"))
                .and_then(|value| value.as_str()),
            Some("SearchContentResult")
        );
        assert_eq!(
            result_params
                .get("result")
                .and_then(|value| value.get("fileCount"))
                .and_then(|value| value.as_u64()),
            Some(1)
        );
        let (result_frame_count, result_file_count_sum, max_result_file_count): (usize, u64, u64) = {
            let frames = sink.frames.lock().expect("frames lock");
            let result_frames: Vec<_> = frames
                .iter()
                .filter(|frame| frame.method.as_deref() == Some("search.job.result"))
                .collect();
            let file_counts: Vec<u64> = result_frames
                .iter()
                .filter_map(|frame| {
                    frame
                        .params
                        .as_ref()
                        .and_then(|params| params.get("result"))
                        .and_then(|result| result.get("fileCount"))
                        .and_then(|value| value.as_u64())
                })
                .collect();
            let file_count_sum = file_counts.iter().sum();
            let max_file_count = file_counts.iter().copied().max().unwrap_or_default();
            (result_frames.len(), file_count_sum, max_file_count)
        };
        assert_eq!(result_frame_count, 20);
        assert_eq!(result_file_count_sum, 20);
        assert_eq!(max_result_file_count, 1);

        let done_params = done_frame
            .expect("done notification")
            .params
            .expect("done params");
        assert_eq!(
            done_params.get("dto").and_then(|value| value.as_str()),
            Some("SearchJobDone")
        );
        assert_eq!(
            done_params
                .get("cancelled")
                .and_then(|value| value.as_bool()),
            Some(false)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_search_benchmark_run_to_contract_dto() {
        let root = test_root("search-benchmark");
        fs::write(root.join("main.py"), "import os\n").expect("write py");
        fs::write(root.join("main.ts"), "import thing from './thing'\n").expect("write ts");

        let response = dispatch_request(
            targeted_request(
                "search.benchmark.run",
                json!({
                    "dto": "SearchBenchmarkRunRequest",
                    "version": 1,
                    "mode": "oneShot",
                    "suiteId": "suite-test",
                    "cases": [{
                        "caseId": "include-py",
                        "query": "import",
                        "includePatterns": ["*.py"],
                        "excludePatterns": [],
                        "useIgnoreFiles": false
                    }]
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let result = response.result.expect("benchmark result");
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("SearchBenchmarkSuiteResult")
        );
        assert_eq!(
            result.get("suiteId").and_then(|value| value.as_str()),
            Some("suite-test")
        );
        let cases = result
            .get("cases")
            .and_then(|value| value.as_array())
            .expect("benchmark cases");
        assert_eq!(cases.len(), 1);
        assert_eq!(
            cases[0].get("lane").and_then(|value| value.as_str()),
            Some("rustOnly")
        );
        assert_eq!(
            cases[0]
                .get("rust")
                .and_then(|value| value.get("matchesFound"))
                .and_then(|value| value.as_u64()),
            Some(1)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn search_job_cancel_reports_missing_job() {
        let root = test_root("search-cancel-missing");
        let response = dispatch_request(
            targeted_request(
                "search.job.cancel",
                json!({
                    "dto": "SearchJobCancelRequest",
                    "version": 1,
                    "jobId": "missing"
                }),
                &root,
                2300,
                "service.search",
            ),
            &PipeIdentity {
                nid: 2300,
                name: "service.search".to_owned(),
            },
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let result = response.result.expect("cancel result");
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("SearchJobCancelResult")
        );
        assert_eq!(
            result.get("ok").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            result.get("status").and_then(|value| value.as_str()),
            Some("not_found")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn unknown_method_returns_typed_error() {
        let root = test_root("unknown");
        let response = dispatch_request(
            request("fs.nope", json!({}), &root),
            &PipeIdentity::framework_rust(),
            &FrameworkServiceScheduler::default(),
            None,
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Error);
        assert_eq!(
            response.error.as_ref().map(|error| error.code.as_str()),
            Some("protocol.methodNotFound")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_git_snapshot_to_contract_dto() {
        let root = test_root("git-snapshot");
        git2::Repository::init(&root).expect("init repo");

        let result = dispatch_git(
            "git.snapshot.get",
            json!({
                "root": path_to_string(&root),
                "includeStatus": true,
                "includeDecorations": true,
                "untracked": "normal"
            }),
            &root,
        )
        .await;
        assert_eq!(
            result.get("dto").and_then(|value| value.as_str()),
            Some("GitSnapshot")
        );
        assert_eq!(
            result
                .get("projectGeneration")
                .and_then(|value| value.as_u64()),
            Some(7)
        );
        assert_eq!(
            result.get("isRepository").and_then(|value| value.as_bool()),
            Some(true)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_git_provider_methods_to_contract_dtos() {
        let root = test_root("git-provider");
        let repo = git2::Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");
        fs::write(root.join("tracked.txt"), "modified\n").expect("modify tracked");
        fs::write(root.join("new.txt"), "new\n").expect("write new");

        let head_blob = dispatch_git(
            "git.headBlob",
            json!({ "root": path_to_string(&root), "relativePath": "tracked.txt" }),
            &root,
        )
        .await;
        assert_eq!(
            head_blob.get("dto").and_then(|value| value.as_str()),
            Some("GitHeadBlobResult")
        );
        assert_eq!(
            head_blob.get("found").and_then(|value| value.as_bool()),
            Some(true)
        );

        let diff = dispatch_git(
            "git.diff",
            json!({ "root": path_to_string(&root), "paths": ["tracked.txt"] }),
            &root,
        )
        .await;
        assert_eq!(
            diff.get("dto").and_then(|value| value.as_str()),
            Some("GitDiffResult")
        );
        assert_eq!(
            diff.get("projectGeneration")
                .and_then(|value| value.as_u64()),
            Some(7)
        );

        let mutation = dispatch_git(
            "git.stage",
            json!({ "root": path_to_string(&root), "paths": ["new.txt"] }),
            &root,
        )
        .await;
        assert_eq!(
            mutation.get("dto").and_then(|value| value.as_str()),
            Some("GitMutationResult")
        );
        assert_eq!(
            mutation.get("operation").and_then(|value| value.as_str()),
            Some("stage")
        );

        let branches = dispatch_git(
            "git.branchList",
            json!({ "root": path_to_string(&root) }),
            &root,
        )
        .await;
        assert_eq!(
            branches.get("dto").and_then(|value| value.as_str()),
            Some("GitBranchList")
        );

        let remote_add = dispatch_git(
            "git.remoteAdd",
            json!({
                "root": path_to_string(&root),
                "name": "origin",
                "fetchUrl": "https://example.invalid/repo.git"
            }),
            &root,
        )
        .await;
        assert_eq!(
            remote_add.get("dto").and_then(|value| value.as_str()),
            Some("GitMutationResult")
        );

        let remotes = dispatch_git(
            "git.remoteList",
            json!({ "root": path_to_string(&root) }),
            &root,
        )
        .await;
        assert_eq!(
            remotes.get("dto").and_then(|value| value.as_str()),
            Some("GitRemoteList")
        );

        let history = dispatch_git(
            "git.history",
            json!({ "root": path_to_string(&root) }),
            &root,
        )
        .await;
        assert_eq!(
            history.get("dto").and_then(|value| value.as_str()),
            Some("GitHistoryResult")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_missing_git_contract_methods_to_dtos() {
        let root = test_root("git-missing-methods");
        let repo = git2::Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        fs::write(root.join("stable.txt"), "stable\n").expect("write stable");
        commit_all(&repo, "initial commit");
        fs::write(root.join("tracked.txt"), "tracked\nmodified\n").expect("modify tracked");
        fs::write(root.join("new.txt"), "new\n").expect("write new");

        let hunks = dispatch_git(
            "git.diff.hunks",
            json!({ "root": path_to_string(&root), "relativePath": "tracked.txt" }),
            &root,
        )
        .await;
        assert_eq!(
            hunks.get("dto").and_then(|value| value.as_str()),
            Some("GitDiffHunks")
        );
        assert_eq!(
            hunks.get("relativePath").and_then(|value| value.as_str()),
            Some("tracked.txt")
        );

        let changes = dispatch_git(
            "git.worktreeChanges.get",
            json!({ "root": path_to_string(&root) }),
            &root,
        )
        .await;
        assert_eq!(
            changes.get("dto").and_then(|value| value.as_str()),
            Some("GitWorktreeChanges")
        );
        assert_eq!(
            changes
                .get("isRepository")
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        let path_index = dispatch_git(
            "git.pathIndex.list",
            json!({ "root": path_to_string(&root) }),
            &root,
        )
        .await;
        assert_eq!(
            path_index.get("dto").and_then(|value| value.as_str()),
            Some("GitPathIndex")
        );
        assert!(
            path_index
                .get("paths")
                .and_then(|value| value.as_array())
                .expect("paths")
                .iter()
                .any(|path| path.as_str() == Some("new.txt"))
        );

        let commit_info = dispatch_git(
            "git.commitInfo.get",
            json!({ "root": path_to_string(&root), "rev": "HEAD" }),
            &root,
        )
        .await;
        assert_eq!(
            commit_info.get("dto").and_then(|value| value.as_str()),
            Some("GitCommitInfoResult")
        );
        assert_eq!(
            commit_info.get("found").and_then(|value| value.as_bool()),
            Some(true)
        );

        let reset = dispatch_git(
            "git.resetHard",
            json!({ "root": path_to_string(&root), "target": "HEAD" }),
            &root,
        )
        .await;
        assert_eq!(
            reset.get("dto").and_then(|value| value.as_str()),
            Some("GitMutationResult")
        );
        assert_eq!(
            reset.get("operation").and_then(|value| value.as_str()),
            Some("resetHard")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn git_job_start_requires_progress_sink_and_cancel_reports_missing_job() {
        let root = test_root("git-job-errors");
        let response = dispatch_git_envelope(
            "git.clone.start",
            json!({
                "url": path_to_string(&root),
                "destination": path_to_string(&root.join("clone"))
            }),
            &root,
            None,
        )
        .await;
        assert_eq!(response.kind, PipeMessageKind::Error);
        assert_eq!(
            response.error.as_ref().map(|error| error.code.as_str()),
            Some("git.unsupported")
        );

        let cancel = dispatch_git("git.job.cancel", json!({ "jobId": "missing-job" }), &root).await;
        assert_eq!(
            cancel.get("dto").and_then(|value| value.as_str()),
            Some("GitJobCancelResult")
        );
        assert_eq!(
            cancel.get("ok").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            cancel.get("status").and_then(|value| value.as_str()),
            Some("not_found")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn dispatches_git_clone_start_and_routes_progress_notifications() {
        let source = test_root("git-clone-source");
        let repo = git2::Repository::init(&source).expect("init source repo");
        fs::write(source.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");

        let destination_root = test_root("git-clone-destination");
        let destination = destination_root.join("clone");
        let scheduler = FrameworkServiceScheduler::default();
        let sink = Arc::new(TestSink::default());
        let response = dispatch_request(
            targeted_request(
                "git.clone.start",
                json!({
                    "url": path_to_string(&source),
                    "destination": path_to_string(&destination)
                }),
                &source,
                2200,
                "service.git",
            ),
            &PipeIdentity {
                nid: 2200,
                name: "service.git".to_owned(),
            },
            &scheduler,
            Some(sink.clone()),
        )
        .await;

        assert_eq!(response.kind, PipeMessageKind::Response);
        let started = response.result.expect("start result");
        assert_eq!(
            started.get("dto").and_then(|value| value.as_str()),
            Some("GitJobStarted")
        );
        assert_eq!(
            started.get("status").and_then(|value| value.as_str()),
            Some("running")
        );

        let mut terminal = None;
        for _ in 0..100 {
            {
                let frames = sink.frames.lock().expect("frames lock");
                terminal = frames.iter().find_map(|frame| {
                    let params = frame.params.as_ref()?;
                    let status = params.get("status")?.as_str()?;
                    if status == "succeeded" {
                        Some(frame.clone())
                    } else {
                        None
                    }
                });
            }
            if terminal.is_some() {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        let terminal = terminal.expect("terminal progress notification");
        assert_eq!(terminal.kind, PipeMessageKind::Notification);
        assert_eq!(terminal.method.as_deref(), Some("git.job.progress"));
        assert_eq!(terminal.target_nid, Some(1100));
        assert_eq!(
            terminal.target_name.as_deref(),
            Some("file_editor_cm6.explorer")
        );
        let params = terminal.params.expect("progress params");
        assert_eq!(
            params.get("dto").and_then(|value| value.as_str()),
            Some("GitJobProgress")
        );
        assert_eq!(
            params.get("operation").and_then(|value| value.as_str()),
            Some("clone")
        );
        assert_eq!(
            params.get("status").and_then(|value| value.as_str()),
            Some("succeeded")
        );

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(destination_root);
    }
}
