use super::{fs_ops, git_ops};
use crate::framework_services::pipe::{
    PipeEventSink,
    protocol::{JSONRPC_VERSION, PROTOCOL_VERSION, PipeEnvelope, PipeMessageKind},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tracing::warn;

const FS_READ_PERMITS: usize = 4;
const FS_WRITE_PERMITS: usize = 2;
const GIT_READ_PERMITS: usize = 4;
const GIT_MUTATION_PERMITS: usize = 2;
const GIT_NETWORK_PERMITS: usize = 1;

#[derive(Clone)]
pub(crate) struct FrameworkServiceScheduler {
    inner: Arc<SchedulerInner>,
}

struct SchedulerInner {
    fs_read: Arc<Semaphore>,
    fs_write: Arc<Semaphore>,
    git_read: Arc<Semaphore>,
    git_mutation: Arc<Semaphore>,
    git_network: Arc<Semaphore>,
    repo_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    git_jobs: Mutex<HashMap<String, Arc<GitJobEntry>>>,
    job_sequence: AtomicU64,
}

struct GitJobEntry {
    job_id: String,
    op_id: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone)]
struct GitJobProgressContext {
    event_sink: Arc<dyn PipeEventSink>,
    request: PipeEnvelope,
    operation: git_ops::GitJobOperation,
    job_id: String,
    op_id: String,
    root: String,
    project_generation: Option<u64>,
    cancelled: Arc<AtomicBool>,
    sequence: Arc<AtomicU64>,
}

impl Default for FrameworkServiceScheduler {
    fn default() -> Self {
        Self {
            inner: Arc::new(SchedulerInner {
                fs_read: Arc::new(Semaphore::new(FS_READ_PERMITS)),
                fs_write: Arc::new(Semaphore::new(FS_WRITE_PERMITS)),
                git_read: Arc::new(Semaphore::new(GIT_READ_PERMITS)),
                git_mutation: Arc::new(Semaphore::new(GIT_MUTATION_PERMITS)),
                git_network: Arc::new(Semaphore::new(GIT_NETWORK_PERMITS)),
                repo_locks: Mutex::new(HashMap::new()),
                git_jobs: Mutex::new(HashMap::new()),
                job_sequence: AtomicU64::new(1),
            }),
        }
    }
}

impl FrameworkServiceScheduler {
    pub(crate) async fn fs_list_directory(
        &self,
        request: fs_ops::FsListDirectoryRequest,
    ) -> Result<fs_ops::FsDirectoryListing, fs_ops::BrowseError> {
        let _permit = self.acquire(self.inner.fs_read.clone()).await?;
        self.spawn_fs(move || fs_ops::list_directory(request)).await
    }

    pub(crate) async fn fs_create_directory(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::create_directory(request))
            .await
    }

    pub(crate) async fn fs_create_file(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::create_file(request)).await
    }

    pub(crate) async fn fs_rename(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::rename_entry(request)).await
    }

    pub(crate) async fn fs_delete(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::delete_entry(request)).await
    }

    pub(crate) async fn fs_copy(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::copy_entry(request)).await
    }

    pub(crate) async fn fs_move(
        &self,
        request: fs_ops::FsMutationRequest,
    ) -> Result<fs_ops::FsMutationResult, fs_ops::BrowseError> {
        self.fs_write(move || fs_ops::move_entry(request)).await
    }

    pub(crate) async fn git_snapshot(
        &self,
        request: git_ops::GitSnapshotRequest,
    ) -> Result<git_ops::GitSnapshot, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_snapshot(request)).await
    }

    pub(crate) async fn git_head_blob(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitHeadBlobResult, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_head_blob(request)).await
    }

    pub(crate) async fn git_diff(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitDiffResult, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_diff(request)).await
    }

    pub(crate) async fn git_diff_hunks(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitDiffHunks, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_diff_hunks(request))
            .await
    }

    pub(crate) async fn git_worktree_changes(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitWorktreeChanges, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_worktree_changes(request))
            .await
    }

    pub(crate) async fn git_path_index(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitPathIndex, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_path_index(request))
            .await
    }

    pub(crate) async fn git_commit_info(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitCommitInfoResult, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_commit_info(request))
            .await
    }

    pub(crate) async fn git_history(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitHistoryResult, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_history(request)).await
    }

    pub(crate) async fn git_branch_list(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitBranchList, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_branch_list(request))
            .await
    }

    pub(crate) async fn git_remote_list(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitRemoteList, git_ops::GitProviderError> {
        self.git_read(move || git_ops::git_remote_list(request))
            .await
    }

    pub(crate) async fn git_stage(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_stage(request))
            .await
    }

    pub(crate) async fn git_unstage(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_unstage(request))
            .await
    }

    pub(crate) async fn git_restore(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_restore(request))
            .await
    }

    pub(crate) async fn git_reset_hard(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_reset_hard(request))
            .await
    }

    pub(crate) async fn git_commit(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_commit(request))
            .await
    }

    pub(crate) async fn git_branch_checkout(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || {
            git_ops::git_branch_checkout(request)
        })
        .await
    }

    pub(crate) async fn git_branch_create(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_branch_create(request))
            .await
    }

    pub(crate) async fn git_remote_add(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_remote_add(request))
            .await
    }

    pub(crate) async fn git_init(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_mutation(request.clone(), move || git_ops::git_init(request))
            .await
    }

    pub(crate) async fn git_pull(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_network(request.clone(), move || git_ops::git_pull(request))
            .await
    }

    pub(crate) async fn git_clone(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_network(request.clone(), move || git_ops::git_clone(request))
            .await
    }

    pub(crate) async fn git_push(
        &self,
        request: git_ops::GitProviderRequest,
    ) -> Result<git_ops::GitMutationResult, git_ops::GitProviderError> {
        self.git_network(request.clone(), move || git_ops::git_push(request))
            .await
    }

    pub(crate) async fn start_git_job(
        &self,
        operation: git_ops::GitJobOperation,
        request_params: git_ops::GitProviderRequest,
        request: PipeEnvelope,
        event_sink: Option<Arc<dyn PipeEventSink>>,
    ) -> Result<git_ops::GitJobStarted, git_ops::GitProviderError> {
        let Some(event_sink) = event_sink else {
            return Err(git_ops::GitProviderError::Unsupported(
                "git job progress requires a pipe event sink".to_owned(),
            ));
        };
        let root = git_job_root(operation, &request_params)?;
        validate_git_job(operation, &request_params)?;
        let sequence = self.inner.job_sequence.fetch_add(1, Ordering::Relaxed);
        let job_id = format!("{}-{sequence}", operation.job_type());
        let op_id = request
            .op_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| job_id.clone());
        let project_generation = request_params
            .project_generation
            .or(request.project_generation);
        let entry = Arc::new(GitJobEntry {
            job_id: job_id.clone(),
            op_id: op_id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
        });
        {
            let mut jobs = self.inner.git_jobs.lock().await;
            jobs.insert(job_id.clone(), Arc::clone(&entry));
            jobs.insert(op_id.clone(), Arc::clone(&entry));
        }

        let context = GitJobProgressContext {
            event_sink,
            request,
            operation,
            job_id: job_id.clone(),
            op_id: op_id.clone(),
            root: root.clone(),
            project_generation,
            cancelled: Arc::clone(&entry.cancelled),
            sequence: Arc::new(AtomicU64::new(1)),
        };
        let scheduler = self.clone();
        tokio::spawn(async move {
            scheduler
                .run_git_job(operation, request_params, context, entry)
                .await;
        });

        Ok(git_ops::GitJobStarted {
            dto: "GitJobStarted",
            version: 1,
            job_id,
            op_id,
            job_type: operation.job_type(),
            operation: operation.operation(),
            root,
            project_generation,
            status: "running",
            message: operation.starting_message().to_owned(),
        })
    }

    pub(crate) async fn cancel_git_job(
        &self,
        request: git_ops::GitJobCancelRequest,
    ) -> Result<git_ops::GitJobCancelResult, git_ops::GitProviderError> {
        let key = request
            .job_id
            .as_deref()
            .or(request.op_id.as_deref())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                git_ops::GitProviderError::Unsupported(
                    "git.job.cancel requires jobId or opId".to_owned(),
                )
            })?;
        let Some(entry) = self.inner.git_jobs.lock().await.get(key).cloned() else {
            return Ok(git_ops::GitJobCancelResult {
                dto: "GitJobCancelResult",
                version: 1,
                job_id: request.job_id.unwrap_or_default(),
                op_id: request.op_id.unwrap_or_default(),
                ok: false,
                status: "not_found".to_owned(),
            });
        };
        entry.cancelled.store(true, Ordering::Relaxed);
        Ok(git_ops::GitJobCancelResult {
            dto: "GitJobCancelResult",
            version: 1,
            job_id: entry.job_id.clone(),
            op_id: entry.op_id.clone(),
            ok: true,
            status: "cancelling".to_owned(),
        })
    }

    async fn run_git_job(
        &self,
        operation: git_ops::GitJobOperation,
        request: git_ops::GitProviderRequest,
        context: GitJobProgressContext,
        entry: Arc<GitJobEntry>,
    ) {
        context.emit_status(
            "running",
            operation.starting_message(),
            git_ops::GitOperationProgress {
                phase: "queued",
                completed: 0,
                total: 0,
                detail: "queued".to_owned(),
            },
            None,
            None,
        );

        let result = if entry.cancelled.load(Ordering::Relaxed) {
            Err(git_ops::GitProviderError::Git(
                "git job cancelled".to_owned(),
            ))
        } else {
            let permit = self.acquire_git(self.inner.git_network.clone()).await;
            match permit {
                Ok(_permit) => {
                    let lock_key = git_lock_key(&request);
                    let lock = self.repo_lock(lock_key).await;
                    let _repo_guard = lock.lock_owned().await;
                    if entry.cancelled.load(Ordering::Relaxed) {
                        Err(git_ops::GitProviderError::Git(
                            "git job cancelled".to_owned(),
                        ))
                    } else {
                        let progress_context = context.clone();
                        self.spawn_git(move || {
                            let progress_context = progress_context;
                            match operation {
                                git_ops::GitJobOperation::Clone => {
                                    git_ops::git_clone_with_progress(request, move |progress| {
                                        progress_context.emit_operation_progress(progress)
                                    })
                                }
                                git_ops::GitJobOperation::Pull => {
                                    git_ops::git_pull_with_progress(request, move |progress| {
                                        progress_context.emit_operation_progress(progress)
                                    })
                                }
                                git_ops::GitJobOperation::Push => {
                                    git_ops::git_push_with_progress(request, move |progress| {
                                        progress_context.emit_operation_progress(progress)
                                    })
                                }
                            }
                        })
                        .await
                    }
                }
                Err(error) => Err(error),
            }
        };

        if context.cancelled.load(Ordering::Relaxed) {
            context.emit_status(
                "cancelled",
                "Git job cancelled",
                git_ops::GitOperationProgress {
                    phase: "cancelled",
                    completed: 0,
                    total: 0,
                    detail: "cancelled".to_owned(),
                },
                None,
                None,
            );
        } else {
            match result {
                Ok(result) => {
                    let result_value = serde_json::to_value(result).ok();
                    context.emit_status(
                        "succeeded",
                        operation.success_message(),
                        git_ops::GitOperationProgress {
                            phase: "complete",
                            completed: 1,
                            total: 1,
                            detail: "complete".to_owned(),
                        },
                        result_value,
                        None,
                    );
                }
                Err(error) => {
                    context.emit_status(
                        "failed",
                        "Git job failed",
                        git_ops::GitOperationProgress {
                            phase: "failed",
                            completed: 0,
                            total: 0,
                            detail: "failed".to_owned(),
                        },
                        None,
                        Some(git_error_progress(error)),
                    );
                }
            }
        }
        self.remove_git_job(&entry).await;
    }

    async fn remove_git_job(&self, entry: &GitJobEntry) {
        let mut jobs = self.inner.git_jobs.lock().await;
        jobs.remove(&entry.job_id);
        jobs.remove(&entry.op_id);
    }

    async fn git_read<T>(
        &self,
        operation: impl FnOnce() -> Result<T, git_ops::GitProviderError> + Send + 'static,
    ) -> Result<T, git_ops::GitProviderError>
    where
        T: Send + 'static,
    {
        let _permit = self.acquire_git(self.inner.git_read.clone()).await?;
        self.spawn_git(operation).await
    }

    async fn git_mutation<T>(
        &self,
        request: git_ops::GitProviderRequest,
        operation: impl FnOnce() -> Result<T, git_ops::GitProviderError> + Send + 'static,
    ) -> Result<T, git_ops::GitProviderError>
    where
        T: Send + 'static,
    {
        let _permit = self.acquire_git(self.inner.git_mutation.clone()).await?;
        let lock_key = git_lock_key(&request);
        let lock = self.repo_lock(lock_key).await;
        let _repo_guard = lock.lock_owned().await;
        self.spawn_git(operation).await
    }

    async fn git_network<T>(
        &self,
        request: git_ops::GitProviderRequest,
        operation: impl FnOnce() -> Result<T, git_ops::GitProviderError> + Send + 'static,
    ) -> Result<T, git_ops::GitProviderError>
    where
        T: Send + 'static,
    {
        let _permit = self.acquire_git(self.inner.git_network.clone()).await?;
        let lock_key = git_lock_key(&request);
        let lock = self.repo_lock(lock_key).await;
        let _repo_guard = lock.lock_owned().await;
        self.spawn_git(operation).await
    }

    async fn repo_lock(&self, key: String) -> Arc<Mutex<()>> {
        let mut locks = self.inner.repo_locks.lock().await;
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn acquire(
        &self,
        semaphore: Arc<Semaphore>,
    ) -> Result<OwnedSemaphorePermit, fs_ops::BrowseError> {
        semaphore
            .acquire_owned()
            .await
            .map_err(|error| fs_ops::BrowseError::Io(std::io::Error::other(error.to_string())))
    }

    async fn acquire_git(
        &self,
        semaphore: Arc<Semaphore>,
    ) -> Result<OwnedSemaphorePermit, git_ops::GitProviderError> {
        semaphore
            .acquire_owned()
            .await
            .map_err(|error| git_ops::GitProviderError::Io(error.to_string()))
    }

    async fn spawn_fs<T>(
        &self,
        operation: impl FnOnce() -> Result<T, fs_ops::BrowseError> + Send + 'static,
    ) -> Result<T, fs_ops::BrowseError>
    where
        T: Send + 'static,
    {
        tokio::task::spawn_blocking(operation)
            .await
            .map_err(|error| fs_ops::BrowseError::Io(std::io::Error::other(error.to_string())))?
    }

    async fn fs_write<T>(
        &self,
        operation: impl FnOnce() -> Result<T, fs_ops::BrowseError> + Send + 'static,
    ) -> Result<T, fs_ops::BrowseError>
    where
        T: Send + 'static,
    {
        let _permit = self.acquire(self.inner.fs_write.clone()).await?;
        self.spawn_fs(operation).await
    }

    async fn spawn_git<T>(
        &self,
        operation: impl FnOnce() -> Result<T, git_ops::GitProviderError> + Send + 'static,
    ) -> Result<T, git_ops::GitProviderError>
    where
        T: Send + 'static,
    {
        tokio::task::spawn_blocking(operation)
            .await
            .map_err(|error| git_ops::GitProviderError::Io(error.to_string()))?
    }
}

impl GitJobProgressContext {
    fn emit_operation_progress(&self, update: git_ops::GitOperationProgress) -> bool {
        if self.cancelled.load(Ordering::Relaxed) {
            return false;
        }
        self.emit_status("running", update.detail.clone(), update, None, None);
        !self.cancelled.load(Ordering::Relaxed)
    }

    fn emit_status(
        &self,
        status: impl Into<String>,
        message: impl Into<String>,
        progress: git_ops::GitOperationProgress,
        result: Option<Value>,
        error: Option<git_ops::GitJobProgressError>,
    ) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let dto = git_ops::GitJobProgress {
            dto: "GitJobProgress",
            version: 1,
            job_id: self.job_id.clone(),
            op_id: self.op_id.clone(),
            job_type: self.operation.job_type(),
            operation: self.operation.operation(),
            root: self.root.clone(),
            project_generation: self.project_generation,
            status: status.into(),
            message: message.into(),
            progress: git_ops::GitJobProgressDetail {
                completed: progress.completed,
                total: progress.total,
                detail: format!("{}: {}", progress.phase, progress.detail),
            },
            result,
            error,
            sequence,
        };
        let envelope = PipeEnvelope {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            kind: PipeMessageKind::Notification,
            id: None,
            method: Some("git.job.progress".to_owned()),
            origin_nid: self.request.target_nid.unwrap_or(2200),
            origin_name: self
                .request
                .target_name
                .clone()
                .unwrap_or_else(|| "service.git".to_owned()),
            target_nid: Some(self.request.origin_nid),
            target_name: Some(self.request.origin_name.clone()),
            project_generation: self.project_generation,
            workspace_root: self.request.workspace_root.clone(),
            correlation_id: self.request.correlation_id.clone(),
            op_id: Some(self.op_id.clone()),
            sequence: Some(sequence),
            params: serde_json::to_value(dto).ok(),
            result: None,
            error: None,
            reason: None,
        };
        if let Err(error) = self.event_sink.send(envelope) {
            warn!(%error, job_id = %self.job_id, "failed to emit git job progress");
        }
    }
}

fn validate_git_job(
    operation: git_ops::GitJobOperation,
    request: &git_ops::GitProviderRequest,
) -> Result<(), git_ops::GitProviderError> {
    match operation {
        git_ops::GitJobOperation::Clone => {
            required_nonempty(
                request.url.as_deref(),
                git_ops::GitProviderError::MissingUrl,
            )?;
            let _ = request
                .destination
                .as_deref()
                .or(request.path.as_deref())
                .or(request.root.as_deref())
                .filter(|value| !value.trim().is_empty())
                .ok_or(git_ops::GitProviderError::MissingDestination)?;
        }
        git_ops::GitJobOperation::Pull | git_ops::GitJobOperation::Push => {
            required_nonempty(
                request.root.as_deref(),
                git_ops::GitProviderError::MissingRoot,
            )?;
        }
    }
    Ok(())
}

fn git_job_root(
    operation: git_ops::GitJobOperation,
    request: &git_ops::GitProviderRequest,
) -> Result<String, git_ops::GitProviderError> {
    match operation {
        git_ops::GitJobOperation::Clone => request
            .destination
            .as_deref()
            .or(request.path.as_deref())
            .or(request.root.as_deref())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or(git_ops::GitProviderError::MissingDestination),
        git_ops::GitJobOperation::Pull | git_ops::GitJobOperation::Push => request
            .root
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or(git_ops::GitProviderError::MissingRoot),
    }
}

fn required_nonempty(
    value: Option<&str>,
    error: git_ops::GitProviderError,
) -> Result<&str, git_ops::GitProviderError> {
    value.filter(|value| !value.trim().is_empty()).ok_or(error)
}

fn git_error_progress(error: git_ops::GitProviderError) -> git_ops::GitJobProgressError {
    let code = match &error {
        git_ops::GitProviderError::MissingRoot => "git.missingRoot",
        git_ops::GitProviderError::MissingPath => "git.missingPath",
        git_ops::GitProviderError::MissingPaths => "git.missingPaths",
        git_ops::GitProviderError::MissingMessage => "git.missingMessage",
        git_ops::GitProviderError::MissingName => "git.missingName",
        git_ops::GitProviderError::MissingUrl => "git.missingUrl",
        git_ops::GitProviderError::MissingDestination => "git.missingDestination",
        git_ops::GitProviderError::InvalidPath(_) => "git.invalidPath",
        git_ops::GitProviderError::NotRepository => "git.notRepository",
        git_ops::GitProviderError::NoHead => "git.noHead",
        git_ops::GitProviderError::Unsupported(_) => "git.unsupported",
        git_ops::GitProviderError::Git(_) => "git.error",
        git_ops::GitProviderError::Io(_) => "git.io",
    };
    git_ops::GitJobProgressError {
        code: code.to_owned(),
        message: git_provider_error_message(error),
    }
}

fn git_provider_error_message(error: git_ops::GitProviderError) -> String {
    match error {
        git_ops::GitProviderError::MissingRoot => {
            "git request requires root or workspaceRoot".to_owned()
        }
        git_ops::GitProviderError::MissingPath => {
            "git request requires path or relativePath".to_owned()
        }
        git_ops::GitProviderError::MissingPaths => {
            "git mutation requires at least one path".to_owned()
        }
        git_ops::GitProviderError::MissingMessage => "git.commit requires message".to_owned(),
        git_ops::GitProviderError::MissingName => "git request requires name or branch".to_owned(),
        git_ops::GitProviderError::MissingUrl => "git request requires url or fetchUrl".to_owned(),
        git_ops::GitProviderError::MissingDestination => {
            "git.clone requires destination, path, or root".to_owned()
        }
        git_ops::GitProviderError::InvalidPath(path) => {
            format!("git path is outside the repository root: {path}")
        }
        git_ops::GitProviderError::NotRepository => {
            "path is not inside a git repository".to_owned()
        }
        git_ops::GitProviderError::NoHead => "repository has no HEAD for this operation".to_owned(),
        git_ops::GitProviderError::Unsupported(message)
        | git_ops::GitProviderError::Git(message)
        | git_ops::GitProviderError::Io(message) => message,
    }
}

fn git_lock_key(request: &git_ops::GitProviderRequest) -> String {
    request
        .root
        .as_deref()
        .or(request.destination.as_deref())
        .or(request.path.as_deref())
        .unwrap_or("<missing-root>")
        .to_owned()
}

#[allow(dead_code)]
fn _fs_write_lane_marker(scheduler: &FrameworkServiceScheduler) -> Arc<Semaphore> {
    scheduler.inner.fs_write.clone()
}

#[allow(dead_code)]
fn _json_marker() -> Value {
    json!({})
}
