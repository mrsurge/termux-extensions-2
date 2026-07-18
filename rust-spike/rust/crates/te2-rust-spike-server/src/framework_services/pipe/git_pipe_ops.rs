use serde_json::json;
use std::sync::Arc;

use super::{
    PipeEventSink,
    protocol::{PipeEnvelope, PipeError, PipeIdentity},
};
use crate::framework_services::{
    git_ops::{self, GitProviderError, GitProviderRequest, GitSnapshotRequest},
    scheduler::FrameworkServiceScheduler,
};

pub(super) async fn dispatch_git_request(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
) -> Option<PipeEnvelope> {
    match request.method.as_deref()? {
        "git.snapshot.get" => Some(snapshot(request, responder, scheduler).await),
        "git.headBlob" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_head_blob(params).await },
            )
            .await,
        ),
        "git.diff" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_diff(params).await },
            )
            .await,
        ),
        "git.diff.hunks" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_diff_hunks(params).await },
            )
            .await,
        ),
        "git.worktreeChanges.get" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_worktree_changes(params).await },
            )
            .await,
        ),
        "git.pathIndex.list" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_path_index(params).await },
            )
            .await,
        ),
        "git.commitInfo.get" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_commit_info(params).await },
            )
            .await,
        ),
        "git.stage" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_stage(params).await },
            )
            .await,
        ),
        "git.unstage" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_unstage(params).await },
            )
            .await,
        ),
        "git.restore" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_restore(params).await },
            )
            .await,
        ),
        "git.resetHard" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_reset_hard(params).await },
            )
            .await,
        ),
        "git.commit" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_commit(params).await },
            )
            .await,
        ),
        "git.branchList" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_branch_list(params).await },
            )
            .await,
        ),
        "git.branchCheckout" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_branch_checkout(params).await },
            )
            .await,
        ),
        "git.branchCreate" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_branch_create(params).await },
            )
            .await,
        ),
        "git.remoteList" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_remote_list(params).await },
            )
            .await,
        ),
        "git.remoteAdd" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_remote_add(params).await },
            )
            .await,
        ),
        "git.history" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_history(params).await },
            )
            .await,
        ),
        "git.init" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_init(params).await },
            )
            .await,
        ),
        "git.pull" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_pull(params).await },
            )
            .await,
        ),
        "git.push" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_push(params).await },
            )
            .await,
        ),
        "git.clone" => Some(
            provider_request(
                request,
                responder,
                scheduler,
                |scheduler, params| async move { scheduler.git_clone(params).await },
            )
            .await,
        ),
        "git.clone.start" => Some(
            git_job_start(
                request,
                responder,
                scheduler,
                event_sink,
                git_ops::GitJobOperation::Clone,
            )
            .await,
        ),
        "git.pull.start" => Some(
            git_job_start(
                request,
                responder,
                scheduler,
                event_sink,
                git_ops::GitJobOperation::Pull,
            )
            .await,
        ),
        "git.push.start" => Some(
            git_job_start(
                request,
                responder,
                scheduler,
                event_sink,
                git_ops::GitJobOperation::Push,
            )
            .await,
        ),
        "git.job.cancel" => Some(git_job_cancel(request, responder, scheduler).await),
        _ => None,
    }
}

async fn snapshot(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
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

    encode_result(request, responder, scheduler.git_snapshot(params).await)
}

async fn provider_request<T, Fut>(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    handler: impl FnOnce(FrameworkServiceScheduler, GitProviderRequest) -> Fut,
) -> PipeEnvelope
where
    T: serde::Serialize,
    Fut: std::future::Future<Output = Result<T, GitProviderError>>,
{
    let Some(params) = provider_params(request, responder) else {
        return invalid_params_error(request, responder, "invalid git provider params");
    };
    encode_result(request, responder, handler(scheduler.clone(), params).await)
}

async fn git_job_start(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
    operation: git_ops::GitJobOperation,
) -> PipeEnvelope {
    let Some(params) = provider_params(request, responder) else {
        return invalid_params_error(request, responder, "invalid git job params");
    };
    match scheduler
        .start_git_job(operation, params, request.clone(), event_sink)
        .await
    {
        Ok(started) => encode_result::<git_ops::GitJobStarted>(request, responder, Ok(started)),
        Err(error) => PipeEnvelope::error_response(request, responder, git_error(error)),
    }
}

async fn git_job_cancel(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let params = match serde_json::from_value::<git_ops::GitJobCancelRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid git.job.cancel params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    encode_result(request, responder, scheduler.cancel_git_job(params).await)
}

fn provider_params(
    request: &PipeEnvelope,
    _responder: &PipeIdentity,
) -> Option<GitProviderRequest> {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = serde_json::from_value::<GitProviderRequest>(params).ok()?;
    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }
    Some(params)
}

fn invalid_params_error(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    message: impl Into<String>,
) -> PipeEnvelope {
    PipeEnvelope::error_response(
        request,
        responder,
        PipeError::new("protocol.invalidParams", message, false, None),
    )
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
        GitProviderError::LocalChangesWouldBeOverwritten(paths) => PipeError::new(
            "git.localChangesWouldBeOverwritten",
            format!(
                "git pull would overwrite local changes: {}",
                paths.join(", ")
            ),
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
