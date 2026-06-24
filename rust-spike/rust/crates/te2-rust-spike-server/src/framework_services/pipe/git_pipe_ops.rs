use serde_json::json;

use super::protocol::{PipeEnvelope, PipeError, PipeIdentity};
use crate::framework_services::git_ops::{
    self, GitProviderError, GitProviderRequest, GitSnapshotRequest,
};

pub(super) fn dispatch_git_request(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
) -> Option<PipeEnvelope> {
    match request.method.as_deref()? {
        "git.snapshot.get" => Some(snapshot(request, responder)),
        "git.headBlob" => Some(provider_request(request, responder, git_ops::git_head_blob)),
        "git.diff" => Some(provider_request(request, responder, git_ops::git_diff)),
        "git.stage" => Some(provider_request(request, responder, git_ops::git_stage)),
        "git.unstage" => Some(provider_request(request, responder, git_ops::git_unstage)),
        "git.restore" => Some(provider_request(request, responder, git_ops::git_restore)),
        "git.commit" => Some(provider_request(request, responder, git_ops::git_commit)),
        "git.branchList" => Some(provider_request(
            request,
            responder,
            git_ops::git_branch_list,
        )),
        "git.branchCheckout" => Some(provider_request(
            request,
            responder,
            git_ops::git_branch_checkout,
        )),
        "git.branchCreate" => Some(provider_request(
            request,
            responder,
            git_ops::git_branch_create,
        )),
        "git.remoteList" => Some(provider_request(
            request,
            responder,
            git_ops::git_remote_list,
        )),
        "git.remoteAdd" => Some(provider_request(
            request,
            responder,
            git_ops::git_remote_add,
        )),
        "git.history" => Some(provider_request(request, responder, git_ops::git_history)),
        "git.init" => Some(provider_request(request, responder, git_ops::git_init)),
        "git.clone" => Some(provider_request(request, responder, git_ops::git_clone)),
        "git.pull" => Some(provider_request(request, responder, git_ops::git_pull)),
        "git.push" => Some(provider_request(request, responder, git_ops::git_push)),
        _ => None,
    }
}

fn snapshot(request: &PipeEnvelope, responder: &PipeIdentity) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<GitSnapshotRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid git.snapshot.get params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };

    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }

    encode_result(request, responder, git_ops::git_snapshot(params))
}

fn provider_request<T>(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    handler: impl FnOnce(GitProviderRequest) -> Result<T, GitProviderError>,
) -> PipeEnvelope
where
    T: serde::Serialize,
{
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<GitProviderRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!(
                        "invalid {} params: {error}",
                        request.method.as_deref().unwrap_or("git request")
                    ),
                    false,
                    None,
                ),
            );
        }
    };

    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }

    encode_result(request, responder, handler(params))
}

fn encode_result<T>(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    result: Result<T, GitProviderError>,
) -> PipeEnvelope
where
    T: serde::Serialize,
{
    match result {
        Ok(result) => match serde_json::to_value(result) {
            Ok(result) => PipeEnvelope::success_response(request, responder, result),
            Err(error) => PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new("protocol.encodeFailed", error.to_string(), false, None),
            ),
        },
        Err(error) => PipeEnvelope::error_response(request, responder, git_error(error)),
    }
}

fn git_error(error: GitProviderError) -> PipeError {
    match error {
        GitProviderError::MissingRoot => PipeError::new(
            "git.missingRoot",
            "git request requires root or workspaceRoot",
            false,
            None,
        ),
        GitProviderError::MissingPath => PipeError::new(
            "git.missingPath",
            "git request requires path or relativePath",
            false,
            None,
        ),
        GitProviderError::MissingPaths => PipeError::new(
            "git.missingPaths",
            "git mutation requires at least one path",
            false,
            None,
        ),
        GitProviderError::MissingMessage => PipeError::new(
            "git.missingMessage",
            "git.commit requires message",
            false,
            None,
        ),
        GitProviderError::MissingName => PipeError::new(
            "git.missingName",
            "git request requires name or branch",
            false,
            None,
        ),
        GitProviderError::MissingUrl => PipeError::new(
            "git.missingUrl",
            "git request requires url or fetchUrl",
            false,
            None,
        ),
        GitProviderError::MissingDestination => PipeError::new(
            "git.missingDestination",
            "git.clone requires destination, path, or root",
            false,
            None,
        ),
        GitProviderError::InvalidPath(path) => PipeError::new(
            "git.invalidPath",
            format!("git path is outside the repository root: {path}"),
            false,
            None,
        ),
        GitProviderError::NotRepository => PipeError::new(
            "git.notRepository",
            "path is not inside a git repository",
            false,
            None,
        ),
        GitProviderError::NoHead => PipeError::new(
            "git.noHead",
            "repository has no HEAD for this operation",
            false,
            None,
        ),
        GitProviderError::Unsupported(message) => {
            PipeError::new("git.unsupported", message, false, None)
        }
        GitProviderError::Git(message) => PipeError::new("git.error", message, false, None),
        GitProviderError::Io(message) => PipeError::new("git.io", message, true, None),
    }
}
