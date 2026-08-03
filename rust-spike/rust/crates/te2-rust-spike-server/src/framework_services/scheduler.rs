use super::{fs_ops, git_ops, run_target_ops, search_ops};
use crate::framework_services::pipe::{
    PipeEventSink,
    protocol::{JSONRPC_VERSION, PROTOCOL_VERSION, PipeEnvelope, PipeMessageKind},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, mpsc};
use tracing::warn;

const FS_READ_PERMITS: usize = 4;
const FS_WRITE_PERMITS: usize = 2;
const GIT_READ_PERMITS: usize = 4;
const GIT_MUTATION_PERMITS: usize = 2;
const GIT_NETWORK_PERMITS: usize = 1;
// Search has its own bounded read-heavy lane so repository scans do not
// consume pipe-dispatch, filesystem mutation, or git-network capacity.
const SEARCH_READ_PERMITS: usize = 4;
const SEARCH_EVENT_QUEUE_CAPACITY: usize = 256;

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
    search_read: Arc<Semaphore>,
    repo_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    git_jobs: Mutex<HashMap<String, Arc<GitJobEntry>>>,
    search_jobs: Mutex<HashMap<String, Arc<SearchJobEntry>>>,
    run_targets: run_target_ops::RunTargetRegistry,
    job_sequence: AtomicU64,
}

struct GitJobEntry {
    job_id: String,
    op_id: String,
    cancelled: Arc<AtomicBool>,
}

struct SearchJobEntry {
    job_id: String,
    search_id: String,
    op_id: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
struct SearchEventMetrics {
    optional_events_dropped: AtomicU64,
    required_event_backpressure_count: AtomicU64,
    required_event_backpressure_nanos: AtomicU64,
    required_event_failures: AtomicU64,
}

enum SearchJobEvent {
    Progress {
        status: String,
        message: String,
        counts: search_ops::SearchProgressCounts,
    },
    ContentResult(search_ops::SearchContentResult),
    Result(Value),
    Done {
        cancelled: bool,
        counts: Option<search_ops::SearchProgressCounts>,
        cancellation_reason: Option<String>,
        truncated: bool,
        truncated_reason: Option<String>,
        match_limit: Option<usize>,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Clone, Copy)]
enum SearchJobKind {
    Files,
    Content,
}

impl SearchJobKind {
    fn label(self) -> &'static str {
        match self {
            Self::Files => "files",
            Self::Content => "content",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Files => "File search started",
            Self::Content => "Content search started",
        }
    }
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

#[derive(Clone)]
struct SearchJobContext {
    event_sink: Arc<dyn PipeEventSink>,
    request: PipeEnvelope,
    kind: SearchJobKind,
    job_id: String,
    search_id: String,
    op_id: String,
    root: String,
    project_generation: Option<u64>,
    correlation_id: Option<String>,
    cancelled: Arc<AtomicBool>,
    sequence: Arc<AtomicU64>,
    last_counts: Arc<StdMutex<search_ops::SearchProgressCounts>>,
    event_metrics: Arc<SearchEventMetrics>,
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
                search_read: Arc::new(Semaphore::new(SEARCH_READ_PERMITS)),
                repo_locks: Mutex::new(HashMap::new()),
                git_jobs: Mutex::new(HashMap::new()),
                search_jobs: Mutex::new(HashMap::new()),
                run_targets: run_target_ops::RunTargetRegistry::default(),
                job_sequence: AtomicU64::new(1),
            }),
        }
    }
}

impl FrameworkServiceScheduler {
    pub(crate) fn run_targets(&self) -> &run_target_ops::RunTargetRegistry {
        &self.inner.run_targets
    }

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

    pub(crate) async fn search_files(
        &self,
        request: search_ops::SearchFilesRequest,
    ) -> Result<search_ops::SearchFilesResult, search_ops::SearchProviderError> {
        self.search_read(move || search_ops::search_files(request))
            .await
    }

    pub(crate) async fn search_content(
        &self,
        request: search_ops::SearchContentRequest,
    ) -> Result<search_ops::SearchContentResult, search_ops::SearchProviderError> {
        self.search_read(move || search_ops::search_content(request))
            .await
    }

    pub(crate) async fn search_benchmark_run(
        &self,
        request: search_ops::SearchBenchmarkRunRequest,
    ) -> Result<search_ops::SearchBenchmarkSuiteResult, search_ops::SearchProviderError> {
        self.search_read(move || search_ops::run_search_benchmark(request))
            .await
    }

    pub(crate) async fn start_search_files_job(
        &self,
        request_params: search_ops::SearchFilesStartRequest,
        request: PipeEnvelope,
        event_sink: Option<Arc<dyn PipeEventSink>>,
    ) -> Result<search_ops::SearchJobStarted, search_ops::SearchProviderError> {
        let correlation_id = request_params
            .correlation_id
            .clone()
            .or_else(|| request.correlation_id.clone());
        let provider_request = request_params.into_provider_request();
        let root = search_ops::resolved_root_string(provider_request.root.as_deref())?;
        let project_generation = provider_request
            .project_generation
            .or(request.project_generation);
        let (started, context, entry) = self
            .prepare_search_job(
                SearchJobKind::Files,
                root,
                project_generation,
                correlation_id,
                request,
                event_sink,
            )
            .await?;
        let scheduler = self.clone();
        tokio::spawn(async move {
            scheduler
                .run_search_files_job(provider_request, context, entry)
                .await;
        });
        Ok(started)
    }

    pub(crate) async fn start_search_content_job(
        &self,
        request_params: search_ops::SearchContentStartRequest,
        request: PipeEnvelope,
        event_sink: Option<Arc<dyn PipeEventSink>>,
    ) -> Result<search_ops::SearchJobStarted, search_ops::SearchProviderError> {
        let correlation_id = request_params
            .correlation_id
            .clone()
            .or_else(|| request.correlation_id.clone());
        let provider_request = request_params.into_provider_request();
        let root = search_ops::resolved_root_string(provider_request.root.as_deref())?;
        let project_generation = provider_request
            .project_generation
            .or(request.project_generation);
        let (started, context, entry) = self
            .prepare_search_job(
                SearchJobKind::Content,
                root,
                project_generation,
                correlation_id,
                request,
                event_sink,
            )
            .await?;
        let scheduler = self.clone();
        tokio::spawn(async move {
            scheduler
                .run_search_content_job(provider_request, context, entry)
                .await;
        });
        Ok(started)
    }

    pub(crate) async fn cancel_search_job(
        &self,
        request: search_ops::SearchJobCancelRequest,
    ) -> Result<search_ops::SearchJobCancelResult, search_ops::SearchProviderError> {
        let key = request
            .job_id
            .as_deref()
            .or(request.search_id.as_deref())
            .or(request.op_id.as_deref())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                search_ops::SearchProviderError::InvalidRequest(
                    "search.job.cancel requires jobId, searchId, or opId".to_owned(),
                )
            })?;
        let Some(entry) = self.inner.search_jobs.lock().await.get(key).cloned() else {
            return Ok(search_ops::SearchJobCancelResult {
                dto: "SearchJobCancelResult",
                version: 1,
                job_id: request.job_id.unwrap_or_default(),
                search_id: request.search_id.unwrap_or_default(),
                op_id: request.op_id.unwrap_or_default(),
                ok: false,
                status: "not_found".to_owned(),
                reason: request.reason,
            });
        };
        entry.cancelled.store(true, Ordering::Relaxed);
        Ok(search_ops::SearchJobCancelResult {
            dto: "SearchJobCancelResult",
            version: 1,
            job_id: entry.job_id.clone(),
            search_id: entry.search_id.clone(),
            op_id: entry.op_id.clone(),
            ok: true,
            status: "cancelling".to_owned(),
            reason: request.reason,
        })
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

    async fn prepare_search_job(
        &self,
        kind: SearchJobKind,
        root: String,
        project_generation: Option<u64>,
        correlation_id: Option<String>,
        request: PipeEnvelope,
        event_sink: Option<Arc<dyn PipeEventSink>>,
    ) -> Result<
        (
            search_ops::SearchJobStarted,
            SearchJobContext,
            Arc<SearchJobEntry>,
        ),
        search_ops::SearchProviderError,
    > {
        let Some(event_sink) = event_sink else {
            return Err(search_ops::SearchProviderError::InvalidRequest(
                "search job progress requires a pipe event sink".to_owned(),
            ));
        };
        let sequence = self.inner.job_sequence.fetch_add(1, Ordering::Relaxed);
        let job_id = format!("search-{}-{sequence}", kind.label());
        let search_id = format!("search-result-{sequence}");
        let op_id = request
            .op_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| job_id.clone());
        let entry = Arc::new(SearchJobEntry {
            job_id: job_id.clone(),
            search_id: search_id.clone(),
            op_id: op_id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
        });
        {
            let mut jobs = self.inner.search_jobs.lock().await;
            jobs.insert(job_id.clone(), Arc::clone(&entry));
            jobs.insert(search_id.clone(), Arc::clone(&entry));
            jobs.insert(op_id.clone(), Arc::clone(&entry));
        }

        let context = SearchJobContext {
            event_sink,
            request,
            kind,
            job_id: job_id.clone(),
            search_id: search_id.clone(),
            op_id: op_id.clone(),
            root: root.clone(),
            project_generation,
            correlation_id: correlation_id.clone(),
            cancelled: Arc::clone(&entry.cancelled),
            sequence: Arc::new(AtomicU64::new(1)),
            last_counts: Arc::new(StdMutex::new(search_ops::SearchProgressCounts::default())),
            event_metrics: Arc::new(SearchEventMetrics::default()),
        };
        Ok((
            search_ops::SearchJobStarted {
                dto: "SearchJobStarted",
                version: 1,
                job_id,
                search_id,
                op_id,
                kind: kind.label(),
                root,
                project_generation,
                correlation_id,
                status: "running",
                message: kind.message().to_owned(),
            },
            context,
            entry,
        ))
    }

    async fn run_search_files_job(
        &self,
        request: search_ops::SearchFilesRequest,
        context: SearchJobContext,
        entry: Arc<SearchJobEntry>,
    ) {
        let (event_tx, event_rx) = mpsc::channel(SEARCH_EVENT_QUEUE_CAPACITY);
        spawn_search_event_emitter(context.clone(), event_rx);
        let _ = try_send_search_event(
            &event_tx,
            SearchJobEvent::Progress {
                status: "running".to_owned(),
                message: "File search queued".to_owned(),
                counts: Default::default(),
            },
            &entry.cancelled,
            &context.event_metrics,
            false,
        );
        let progress_tx = event_tx.clone();
        let progress_cancelled = Arc::clone(&entry.cancelled);
        let progress_metrics = Arc::clone(&context.event_metrics);
        let options = search_ops::SearchRunOptions {
            search_id: None,
            job_id: Some(context.job_id.clone()),
            cancelled: Some(Arc::clone(&entry.cancelled)),
            progress: Some(Arc::new(move |counts| {
                try_send_search_event(
                    &progress_tx,
                    SearchJobEvent::Progress {
                        status: "running".to_owned(),
                        message: "File search running".to_owned(),
                        counts,
                    },
                    &progress_cancelled,
                    &progress_metrics,
                    false,
                )
            })),
            content_result: None,
        };
        let result = if entry.cancelled.load(Ordering::Relaxed) {
            Err(search_ops::SearchProviderError::Cancelled)
        } else {
            self.search_read(move || search_ops::search_files_with_options(request, options))
                .await
                .and_then(|result| {
                    serde_json::to_value(result)
                        .map_err(|error| search_ops::SearchProviderError::Search(error.to_string()))
                })
        };
        self.finish_search_job(result, context, entry, true, event_tx)
            .await;
    }

    async fn run_search_content_job(
        &self,
        request: search_ops::SearchContentRequest,
        context: SearchJobContext,
        entry: Arc<SearchJobEntry>,
    ) {
        let (event_tx, event_rx) = mpsc::channel(SEARCH_EVENT_QUEUE_CAPACITY);
        spawn_search_event_emitter(context.clone(), event_rx);
        let _ = try_send_search_event(
            &event_tx,
            SearchJobEvent::Progress {
                status: "running".to_owned(),
                message: "Content search queued".to_owned(),
                counts: Default::default(),
            },
            &entry.cancelled,
            &context.event_metrics,
            false,
        );
        let progress_tx = event_tx.clone();
        let progress_cancelled = Arc::clone(&entry.cancelled);
        let progress_metrics = Arc::clone(&context.event_metrics);
        let result_tx = event_tx.clone();
        let result_cancelled = Arc::clone(&entry.cancelled);
        let result_metrics = Arc::clone(&context.event_metrics);
        let options = search_ops::SearchRunOptions {
            search_id: Some(context.search_id.clone()),
            job_id: Some(context.job_id.clone()),
            cancelled: Some(Arc::clone(&entry.cancelled)),
            progress: Some(Arc::new(move |counts| {
                try_send_search_event(
                    &progress_tx,
                    SearchJobEvent::Progress {
                        status: "running".to_owned(),
                        message: "Content search running".to_owned(),
                        counts,
                    },
                    &progress_cancelled,
                    &progress_metrics,
                    false,
                )
            })),
            content_result: Some(Arc::new(move |result| {
                send_required_search_event_blocking(
                    &result_tx,
                    SearchJobEvent::ContentResult(result),
                    &result_cancelled,
                    &result_metrics,
                )
            })),
        };
        let result = if entry.cancelled.load(Ordering::Relaxed) {
            Err(search_ops::SearchProviderError::Cancelled)
        } else {
            self.search_read(move || search_ops::search_content_with_options(request, options))
                .await
                .and_then(|result| {
                    serde_json::to_value(result)
                        .map_err(|error| search_ops::SearchProviderError::Search(error.to_string()))
                })
        };
        self.finish_search_job(result, context, entry, false, event_tx)
            .await;
    }

    async fn finish_search_job(
        &self,
        result: Result<Value, search_ops::SearchProviderError>,
        context: SearchJobContext,
        entry: Arc<SearchJobEntry>,
        emit_result: bool,
        event_tx: mpsc::Sender<SearchJobEvent>,
    ) {
        if context.cancelled.load(Ordering::Relaxed) {
            let _ = send_search_event(
                &event_tx,
                SearchJobEvent::Done {
                    cancelled: true,
                    counts: None,
                    cancellation_reason: Some(context.cancellation_reason()),
                    truncated: false,
                    truncated_reason: None,
                    match_limit: None,
                },
                &entry.cancelled,
            )
            .await;
        } else {
            match result {
                Ok(result) => {
                    let counts = search_counts_from_result(&result);
                    let completion = search_completion_from_result(&result);
                    if emit_result {
                        let _ = send_search_event(
                            &event_tx,
                            SearchJobEvent::Result(result),
                            &entry.cancelled,
                        )
                        .await;
                    }
                    let cancelled = context.cancelled.load(Ordering::Relaxed);
                    let _ = send_search_event(
                        &event_tx,
                        SearchJobEvent::Done {
                            cancelled,
                            counts,
                            cancellation_reason: cancelled.then(|| context.cancellation_reason()),
                            truncated: completion.truncated,
                            truncated_reason: completion.truncated_reason,
                            match_limit: completion.match_limit,
                        },
                        &entry.cancelled,
                    )
                    .await;
                }
                Err(search_ops::SearchProviderError::Cancelled) => {
                    let _ = send_search_event(
                        &event_tx,
                        SearchJobEvent::Done {
                            cancelled: true,
                            counts: None,
                            cancellation_reason: Some(context.cancellation_reason()),
                            truncated: false,
                            truncated_reason: None,
                            match_limit: None,
                        },
                        &entry.cancelled,
                    )
                    .await;
                }
                Err(error) => {
                    let code = search_error_code(&error).to_owned();
                    let message = search_provider_error_message(error);
                    let _ = send_search_event(
                        &event_tx,
                        SearchJobEvent::Error { code, message },
                        &entry.cancelled,
                    )
                    .await;
                }
            }
        }
        drop(event_tx);
        self.remove_search_job(&entry).await;
    }

    async fn remove_search_job(&self, entry: &SearchJobEntry) {
        let mut jobs = self.inner.search_jobs.lock().await;
        jobs.remove(&entry.job_id);
        jobs.remove(&entry.search_id);
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

    async fn acquire_search(
        &self,
        semaphore: Arc<Semaphore>,
    ) -> Result<OwnedSemaphorePermit, search_ops::SearchProviderError> {
        semaphore
            .acquire_owned()
            .await
            .map_err(|error| search_ops::SearchProviderError::Io(error.to_string()))
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

    async fn search_read<T>(
        &self,
        operation: impl FnOnce() -> Result<T, search_ops::SearchProviderError> + Send + 'static,
    ) -> Result<T, search_ops::SearchProviderError>
    where
        T: Send + 'static,
    {
        let _permit = self.acquire_search(self.inner.search_read.clone()).await?;
        self.spawn_search(operation).await
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

    async fn spawn_search<T>(
        &self,
        operation: impl FnOnce() -> Result<T, search_ops::SearchProviderError> + Send + 'static,
    ) -> Result<T, search_ops::SearchProviderError>
    where
        T: Send + 'static,
    {
        tokio::task::spawn_blocking(operation)
            .await
            .map_err(|error| search_ops::SearchProviderError::Io(error.to_string()))?
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

impl SearchJobContext {
    fn emit_event(&self, event: SearchJobEvent) {
        match event {
            SearchJobEvent::Progress {
                status,
                message,
                counts,
            } => self.emit_progress(status, message, counts),
            SearchJobEvent::ContentResult(result) => match serde_json::to_value(result) {
                Ok(result) => self.emit_result(result),
                Err(error) => self.emit_error("protocol.encodeFailed", error.to_string()),
            },
            SearchJobEvent::Result(result) => self.emit_result(result),
            SearchJobEvent::Done {
                cancelled,
                counts,
                cancellation_reason,
                truncated,
                truncated_reason,
                match_limit,
            } => self.emit_done(
                cancelled,
                counts,
                cancellation_reason,
                truncated,
                truncated_reason,
                match_limit,
            ),
            SearchJobEvent::Error { code, message } => self.emit_error(code, message),
        }
    }

    fn emit_progress(
        &self,
        status: impl Into<String>,
        message: impl Into<String>,
        counts: search_ops::SearchProgressCounts,
    ) {
        if let Ok(mut last_counts) = self.last_counts.lock() {
            *last_counts = counts;
        }
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let dto = search_ops::SearchJobProgress {
            dto: "SearchJobProgress",
            version: 1,
            job_id: self.job_id.clone(),
            search_id: self.search_id.clone(),
            op_id: self.op_id.clone(),
            kind: self.kind.label(),
            root: self.root.clone(),
            project_generation: self.project_generation,
            correlation_id: self.correlation_id.clone(),
            status: status.into(),
            message: message.into(),
            files_scanned: counts.files_scanned,
            files_matched: counts.files_matched,
            matches_found: counts.matches_found,
            sequence,
        };
        self.emit("search.job.progress", dto, sequence);
    }

    fn emit_result(&self, result: Value) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let dto = search_ops::SearchJobResult {
            dto: "SearchJobResult",
            version: 1,
            job_id: self.job_id.clone(),
            search_id: self.search_id.clone(),
            op_id: self.op_id.clone(),
            kind: self.kind.label(),
            root: self.root.clone(),
            project_generation: self.project_generation,
            correlation_id: self.correlation_id.clone(),
            result,
            sequence,
        };
        self.emit("search.job.result", dto, sequence);
    }

    fn emit_done(
        &self,
        cancelled: bool,
        counts: Option<search_ops::SearchProgressCounts>,
        cancellation_reason: Option<String>,
        truncated: bool,
        truncated_reason: Option<String>,
        match_limit: Option<usize>,
    ) {
        let counts = counts.unwrap_or_else(|| {
            self.last_counts
                .lock()
                .map(|counts| *counts)
                .unwrap_or_default()
        });
        let required_event_backpressure_nanos = self
            .event_metrics
            .required_event_backpressure_nanos
            .load(Ordering::Relaxed);
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let dto = search_ops::SearchJobDone {
            dto: "SearchJobDone",
            version: 1,
            job_id: self.job_id.clone(),
            search_id: self.search_id.clone(),
            op_id: self.op_id.clone(),
            kind: self.kind.label(),
            root: self.root.clone(),
            project_generation: self.project_generation,
            correlation_id: self.correlation_id.clone(),
            status: "done",
            files_scanned: counts.files_scanned,
            files_matched: counts.files_matched,
            matches_found: counts.matches_found,
            cancelled,
            cancellation_reason,
            truncated,
            truncated_reason,
            match_limit,
            optional_events_dropped: self
                .event_metrics
                .optional_events_dropped
                .load(Ordering::Relaxed),
            required_event_backpressure_count: self
                .event_metrics
                .required_event_backpressure_count
                .load(Ordering::Relaxed),
            required_event_backpressure_ms: required_event_backpressure_nanos / 1_000_000,
            required_event_failures: self
                .event_metrics
                .required_event_failures
                .load(Ordering::Relaxed),
            sequence,
        };
        self.emit("search.job.done", dto, sequence);
    }

    fn emit_error(&self, code: impl Into<String>, message: impl Into<String>) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let dto = search_ops::SearchJobError {
            dto: "SearchJobError",
            version: 1,
            job_id: self.job_id.clone(),
            search_id: self.search_id.clone(),
            op_id: self.op_id.clone(),
            kind: self.kind.label(),
            root: self.root.clone(),
            project_generation: self.project_generation,
            correlation_id: self.correlation_id.clone(),
            status: "error",
            code: code.into(),
            message: message.into(),
            sequence,
        };
        self.emit("search.job.error", dto, sequence);
    }

    fn emit<T>(&self, method: &str, dto: T, sequence: u64)
    where
        T: serde::Serialize,
    {
        let envelope = PipeEnvelope {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            kind: PipeMessageKind::Notification,
            id: None,
            method: Some(method.to_owned()),
            origin_nid: self.request.target_nid.unwrap_or(2300),
            origin_name: self
                .request
                .target_name
                .clone()
                .unwrap_or_else(|| "service.search".to_owned()),
            target_nid: Some(self.request.origin_nid),
            target_name: Some(self.request.origin_name.clone()),
            project_generation: self.project_generation,
            workspace_root: self.request.workspace_root.clone(),
            correlation_id: self.correlation_id.clone(),
            op_id: Some(self.op_id.clone()),
            sequence: Some(sequence),
            params: serde_json::to_value(dto).ok(),
            result: None,
            error: None,
            reason: None,
        };
        if let Err(error) = self.event_sink.send(envelope) {
            warn!(%error, job_id = %self.job_id, "failed to emit search job notification");
        }
    }

    fn cancellation_reason(&self) -> String {
        if self
            .event_metrics
            .required_event_failures
            .load(Ordering::Relaxed)
            > 0
        {
            "eventDeliveryFailed".to_owned()
        } else {
            "cancelled".to_owned()
        }
    }
}

fn spawn_search_event_emitter(
    context: SearchJobContext,
    mut event_rx: mpsc::Receiver<SearchJobEvent>,
) {
    tokio::task::spawn_blocking(move || {
        while let Some(event) = event_rx.blocking_recv() {
            context.emit_event(event);
        }
    });
}

fn try_send_search_event(
    event_tx: &mpsc::Sender<SearchJobEvent>,
    event: SearchJobEvent,
    cancelled: &Arc<AtomicBool>,
    metrics: &Arc<SearchEventMetrics>,
    required: bool,
) -> bool {
    match event_tx.try_send(event) {
        Ok(()) => !cancelled.load(Ordering::Relaxed),
        Err(mpsc::error::TrySendError::Full(_)) if !required => {
            metrics
                .optional_events_dropped
                .fetch_add(1, Ordering::Relaxed);
            !cancelled.load(Ordering::Relaxed)
        }
        Err(error) => {
            metrics
                .required_event_failures
                .fetch_add(1, Ordering::Relaxed);
            cancelled.store(true, Ordering::Relaxed);
            warn!(%error, "search event queue failed; cancelling search job");
            false
        }
    }
}

fn send_required_search_event_blocking(
    event_tx: &mpsc::Sender<SearchJobEvent>,
    event: SearchJobEvent,
    cancelled: &Arc<AtomicBool>,
    metrics: &Arc<SearchEventMetrics>,
) -> bool {
    if cancelled.load(Ordering::Relaxed) {
        return false;
    }
    match event_tx.try_send(event) {
        Ok(()) => !cancelled.load(Ordering::Relaxed),
        Err(mpsc::error::TrySendError::Full(event)) => {
            metrics
                .required_event_backpressure_count
                .fetch_add(1, Ordering::Relaxed);
            let started = Instant::now();
            let result = event_tx.blocking_send(event);
            let elapsed = started.elapsed().as_nanos();
            metrics
                .required_event_backpressure_nanos
                .fetch_add(elapsed.min(u128::from(u64::MAX)) as u64, Ordering::Relaxed);
            match result {
                Ok(()) => !cancelled.load(Ordering::Relaxed),
                Err(error) => {
                    metrics
                        .required_event_failures
                        .fetch_add(1, Ordering::Relaxed);
                    cancelled.store(true, Ordering::Relaxed);
                    warn!(%error, "search event queue closed; cancelling search job");
                    false
                }
            }
        }
        Err(error) => {
            metrics
                .required_event_failures
                .fetch_add(1, Ordering::Relaxed);
            cancelled.store(true, Ordering::Relaxed);
            warn!(%error, "search event queue failed; cancelling search job");
            false
        }
    }
}

async fn send_search_event(
    event_tx: &mpsc::Sender<SearchJobEvent>,
    event: SearchJobEvent,
    cancelled: &Arc<AtomicBool>,
) -> bool {
    match event_tx.send(event).await {
        Ok(()) => !cancelled.load(Ordering::Relaxed),
        Err(error) => {
            cancelled.store(true, Ordering::Relaxed);
            warn!(%error, "search event queue closed; cancelling search job");
            false
        }
    }
}

fn search_counts_from_result(result: &Value) -> Option<search_ops::SearchProgressCounts> {
    let files_matched = result
        .get("totalFileCount")
        .and_then(Value::as_u64)
        .or_else(|| result.get("count").and_then(Value::as_u64))
        .or_else(|| result.get("fileCount").and_then(Value::as_u64))?;
    let matches_found = result
        .get("totalMatchCount")
        .and_then(Value::as_u64)
        .or_else(|| result.get("matchCount").and_then(Value::as_u64))
        .unwrap_or(files_matched);
    let files_scanned = result
        .get("filesScanned")
        .and_then(Value::as_u64)
        .unwrap_or(files_matched);
    Some(search_ops::SearchProgressCounts {
        files_scanned: usize::try_from(files_scanned).unwrap_or(usize::MAX),
        files_matched: usize::try_from(files_matched).unwrap_or(usize::MAX),
        matches_found: usize::try_from(matches_found).unwrap_or(usize::MAX),
    })
}

#[derive(Default)]
struct SearchCompletionMetadata {
    truncated: bool,
    truncated_reason: Option<String>,
    match_limit: Option<usize>,
}

fn search_completion_from_result(result: &Value) -> SearchCompletionMetadata {
    SearchCompletionMetadata {
        truncated: result
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        truncated_reason: result
            .get("truncatedReason")
            .and_then(Value::as_str)
            .map(str::to_owned),
        match_limit: result
            .get("matchLimit")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok()),
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
        git_ops::GitProviderError::LocalChangesWouldBeOverwritten(_) => {
            "git.localChangesWouldBeOverwritten"
        }
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
        git_ops::GitProviderError::LocalChangesWouldBeOverwritten(paths) => {
            format!(
                "git pull would overwrite local changes: {}",
                paths.join(", ")
            )
        }
        git_ops::GitProviderError::Unsupported(message)
        | git_ops::GitProviderError::Git(message)
        | git_ops::GitProviderError::Io(message) => message,
    }
}

fn search_error_code(error: &search_ops::SearchProviderError) -> &'static str {
    match error {
        search_ops::SearchProviderError::MissingRoot => "search.missingRoot",
        search_ops::SearchProviderError::InvalidRoot(_) => "search.invalidRoot",
        search_ops::SearchProviderError::InvalidPattern(_) => "search.invalidPattern",
        search_ops::SearchProviderError::InvalidRegex(_) => "search.invalidRegex",
        search_ops::SearchProviderError::InvalidRequest(_) => "search.invalidRequest",
        search_ops::SearchProviderError::Cancelled => "search.cancelled",
        search_ops::SearchProviderError::Io(_) => "search.io",
        search_ops::SearchProviderError::Search(_) => "search.failed",
    }
}

fn search_provider_error_message(error: search_ops::SearchProviderError) -> String {
    match error {
        search_ops::SearchProviderError::MissingRoot => {
            "search request requires root or workspaceRoot".to_owned()
        }
        search_ops::SearchProviderError::InvalidRoot(message)
        | search_ops::SearchProviderError::InvalidPattern(message)
        | search_ops::SearchProviderError::InvalidRegex(message)
        | search_ops::SearchProviderError::InvalidRequest(message)
        | search_ops::SearchProviderError::Io(message)
        | search_ops::SearchProviderError::Search(message) => message,
        search_ops::SearchProviderError::Cancelled => "search job cancelled".to_owned(),
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
