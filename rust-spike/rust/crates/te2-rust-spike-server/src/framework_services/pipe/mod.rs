#![allow(dead_code)] // Staged pipe protocol surface; runtime shell wiring follows later.

mod fs_pipe_ops;
mod git_pipe_ops;
pub(crate) mod protocol;

use protocol::{PipeEnvelope, PipeError, PipeIdentity, PipeMessageKind};

pub(crate) fn dispatch_request(request: PipeEnvelope, responder: &PipeIdentity) -> PipeEnvelope {
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

    if let Some(response) = fs_pipe_ops::dispatch_fs_request(&request, responder) {
        return response;
    }
    if let Some(response) = git_pipe_ops::dispatch_git_request(&request, responder) {
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
    use std::{fs, path::PathBuf};

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

    fn dispatch_git(
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
        );
        assert_eq!(response.kind, PipeMessageKind::Response);
        response.result.expect("response result")
    }

    #[test]
    fn line_codec_round_trips_request_envelope() {
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

    #[test]
    fn dispatches_fs_list_directory_to_contract_dto() {
        let root = test_root("dispatch");
        fs::write(root.join("main.py"), "print('hello')\n").expect("write file");

        let response = dispatch_request(
            request("fs.listDirectory", json!({ "path": "." }), &root),
            &PipeIdentity::framework_rust(),
        );

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

    #[test]
    fn unknown_method_returns_typed_error() {
        let root = test_root("unknown");
        let response = dispatch_request(
            request("fs.nope", json!({}), &root),
            &PipeIdentity::framework_rust(),
        );

        assert_eq!(response.kind, PipeMessageKind::Error);
        assert_eq!(
            response.error.as_ref().map(|error| error.code.as_str()),
            Some("protocol.methodNotFound")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dispatches_git_snapshot_to_contract_dto() {
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
        );
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

    #[test]
    fn dispatches_git_provider_methods_to_contract_dtos() {
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
        );
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
        );
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
        );
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
        );
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
        );
        assert_eq!(
            remote_add.get("dto").and_then(|value| value.as_str()),
            Some("GitMutationResult")
        );

        let remotes = dispatch_git(
            "git.remoteList",
            json!({ "root": path_to_string(&root) }),
            &root,
        );
        assert_eq!(
            remotes.get("dto").and_then(|value| value.as_str()),
            Some("GitRemoteList")
        );

        let history = dispatch_git(
            "git.history",
            json!({ "root": path_to_string(&root) }),
            &root,
        );
        assert_eq!(
            history.get("dto").and_then(|value| value.as_str()),
            Some("GitHistoryResult")
        );

        let _ = fs::remove_dir_all(root);
    }
}
