use super::common::{expand_user_path, home_dir, normalize_lexical, path_to_string};
use git2::{
    BranchType, Config, Cred, Delta, Diff, DiffFormat, DiffOptions, ErrorCode, FetchOptions,
    IndexAddOption, Oid, PushOptions, RemoteCallbacks, Repository, ResetType, Signature, Status,
    StatusOptions, StatusShow,
    build::{CheckoutBuilder, RepoBuilder},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub(crate) struct GitSummaryRequest {
    pub(crate) path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitSummaryData {
    pub(crate) is_repo: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) head_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) head_short: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

impl GitSummaryData {
    fn not_repo() -> Self {
        Self {
            is_repo: false,
            branch: None,
            head_hash: None,
            head_short: None,
            summary: None,
            error: None,
        }
    }

    fn error(is_repo: bool, error: impl Into<String>) -> Self {
        Self {
            is_repo,
            branch: None,
            head_hash: None,
            head_short: None,
            summary: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSnapshotRequest {
    pub(crate) root: Option<String>,
    #[serde(default)]
    pub(crate) project_generation: Option<u64>,
    #[serde(default)]
    pub(crate) include_status: Option<bool>,
    #[serde(default)]
    pub(crate) include_decorations: Option<bool>,
    #[serde(default)]
    pub(crate) untracked: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitProviderRequest {
    pub(crate) root: Option<String>,
    #[serde(default)]
    pub(crate) project_generation: Option<u64>,
    #[serde(default)]
    pub(crate) relative_path: Option<String>,
    #[serde(default)]
    pub(crate) path: Option<String>,
    #[serde(default)]
    pub(crate) paths: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) base: Option<String>,
    #[serde(default)]
    pub(crate) rev: Option<String>,
    #[serde(default)]
    pub(crate) cached: Option<bool>,
    #[serde(default)]
    pub(crate) staged: Option<bool>,
    #[serde(default)]
    pub(crate) message: Option<String>,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) branch: Option<String>,
    #[serde(default)]
    pub(crate) target: Option<String>,
    #[serde(default)]
    pub(crate) remote: Option<String>,
    #[serde(default)]
    pub(crate) remote_name: Option<String>,
    #[serde(default)]
    pub(crate) fetch_url: Option<String>,
    #[serde(default)]
    pub(crate) push_url: Option<String>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) destination: Option<String>,
    #[serde(default)]
    pub(crate) limit: Option<usize>,
    #[serde(default)]
    pub(crate) force: Option<bool>,
    #[serde(default)]
    pub(crate) depth: Option<usize>,
    #[serde(default)]
    pub(crate) rebase: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHeadRef {
    pub(crate) full: String,
    pub(crate) short: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSnapshot {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_path: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) is_repository: bool,
    pub(crate) has_head: bool,
    pub(crate) branch: Option<String>,
    pub(crate) detached: bool,
    pub(crate) head: Option<GitHeadRef>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    pub(crate) staged: Vec<String>,
    pub(crate) unstaged: Vec<String>,
    pub(crate) untracked: Vec<String>,
    pub(crate) statuses: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitMutationResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) operation: String,
    pub(crate) ok: bool,
    pub(crate) changed_paths: Vec<String>,
    pub(crate) status_invalidated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "payloadKind")]
pub(crate) enum GitTextPayload {
    #[serde(rename = "string", rename_all = "camelCase")]
    String {
        encoding: &'static str,
        value: String,
    },
}

impl GitTextPayload {
    fn utf8(value: String) -> Self {
        Self::String {
            encoding: "utf-8",
            value,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffFile {
    pub(crate) relative_path: String,
    pub(crate) status: String,
    pub(crate) patch: GitTextPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) content_suppressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) suppressed_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) display_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) line_byte_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) base: String,
    pub(crate) paths: Vec<String>,
    pub(crate) files: Vec<GitDiffFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffHunkLine {
    #[serde(rename = "type")]
    pub(crate) line_type: String,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffHunk {
    pub(crate) old_start: u32,
    pub(crate) old_lines: u32,
    pub(crate) new_start: u32,
    pub(crate) new_lines: u32,
    pub(crate) lines: Vec<GitDiffHunkLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffHunksSummary {
    pub(crate) added: usize,
    pub(crate) deleted: usize,
    pub(crate) tracked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) content_suppressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) suppressed_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) display_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) line_byte_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffHunks {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) relative_path: String,
    pub(crate) base: String,
    pub(crate) hunks: Vec<GitDiffHunk>,
    pub(crate) summary: GitDiffHunksSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHeadBlobResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) relative_path: String,
    pub(crate) found: bool,
    pub(crate) content: Option<GitTextPayload>,
    pub(crate) head: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchItem {
    pub(crate) name: String,
    pub(crate) current: bool,
    pub(crate) remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchList {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) current: Option<String>,
    pub(crate) branches: Vec<GitBranchItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRemoteItem {
    pub(crate) name: String,
    pub(crate) fetch_url: Option<String>,
    pub(crate) push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRemoteList {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) remotes: Vec<GitRemoteItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeChange {
    pub(crate) path: String,
    pub(crate) code: String,
    pub(crate) original_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeChanges {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) base: String,
    pub(crate) is_repository: bool,
    pub(crate) changes: Vec<GitWorktreeChange>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPathIndex {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) is_repository: bool,
    pub(crate) paths: Vec<String>,
    pub(crate) source: &'static str,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommitInfo {
    pub(crate) hash: String,
    pub(crate) short_hash: String,
    pub(crate) summary: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommitInfoResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) found: bool,
    pub(crate) commit: Option<GitCommitInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitJobOperation {
    Clone,
    Pull,
    Push,
}

impl GitJobOperation {
    pub(crate) fn operation(self) -> &'static str {
        match self {
            Self::Clone => "clone",
            Self::Pull => "pull",
            Self::Push => "push",
        }
    }

    pub(crate) fn job_type(self) -> &'static str {
        match self {
            Self::Clone => "git_clone",
            Self::Pull => "git_pull",
            Self::Push => "git_push",
        }
    }

    pub(crate) fn starting_message(self) -> &'static str {
        match self {
            Self::Clone => "Starting clone",
            Self::Pull => "Starting pull",
            Self::Push => "Starting push",
        }
    }

    pub(crate) fn success_message(self) -> &'static str {
        match self {
            Self::Clone => "Cloned repository",
            Self::Pull => "Pulled repository",
            Self::Push => "Pushed repository",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobStarted {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) op_id: String,
    #[serde(rename = "type")]
    pub(crate) job_type: &'static str,
    pub(crate) operation: &'static str,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) status: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobProgressDetail {
    pub(crate) completed: u64,
    pub(crate) total: u64,
    pub(crate) detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobProgressError {
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobProgress {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) op_id: String,
    #[serde(rename = "type")]
    pub(crate) job_type: &'static str,
    pub(crate) operation: &'static str,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) status: String,
    pub(crate) message: String,
    pub(crate) progress: GitJobProgressDetail,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<GitJobProgressError>,
    pub(crate) sequence: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobCancelRequest {
    #[serde(default)]
    pub(crate) job_id: Option<String>,
    #[serde(default)]
    pub(crate) op_id: Option<String>,
    #[serde(default)]
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitJobCancelResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) op_id: String,
    pub(crate) ok: bool,
    pub(crate) status: String,
}

#[derive(Debug, Clone)]
pub(crate) struct GitOperationProgress {
    pub(crate) phase: &'static str,
    pub(crate) completed: u64,
    pub(crate) total: u64,
    pub(crate) detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHistoryCommit {
    pub(crate) id: String,
    pub(crate) short: String,
    pub(crate) summary: Option<String>,
    pub(crate) author_name: Option<String>,
    pub(crate) author_email: Option<String>,
    pub(crate) time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHistoryResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) project_generation: Option<u64>,
    pub(crate) commits: Vec<GitHistoryCommit>,
}

#[derive(Debug)]
pub(crate) enum GitSummaryError {
    MissingPath,
}

#[derive(Debug)]
pub(crate) enum GitProviderError {
    MissingRoot,
    MissingPath,
    MissingPaths,
    MissingMessage,
    MissingName,
    MissingUrl,
    MissingDestination,
    InvalidPath(String),
    NotRepository,
    NoHead,
    LocalChangesWouldBeOverwritten(Vec<String>),
    Unsupported(String),
    Git(String),
    Io(String),
}

impl From<git2::Error> for GitProviderError {
    fn from(error: git2::Error) -> Self {
        Self::Git(error.message().to_owned())
    }
}

impl From<std::io::Error> for GitProviderError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

pub(crate) fn git_summary(request: GitSummaryRequest) -> Result<GitSummaryData, GitSummaryError> {
    let Some(raw_path) = request
        .path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    else {
        return Err(GitSummaryError::MissingPath);
    };
    Ok(git_summary_for_path(raw_path))
}

pub(crate) fn git_snapshot(request: GitSnapshotRequest) -> Result<GitSnapshot, GitProviderError> {
    let Some(raw_root) = request
        .root
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    else {
        return Err(GitProviderError::MissingRoot);
    };
    let root = normalize_existing_path(raw_root);
    Ok(git_snapshot_for_root(
        root,
        request.project_generation,
        request.include_status.unwrap_or(true),
        request.include_decorations.unwrap_or(true),
        request.untracked.as_deref().unwrap_or("normal"),
    ))
}

pub(crate) fn git_head_blob(
    request: GitProviderRequest,
) -> Result<GitHeadBlobResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let relative_path = single_relative_path(&repo, &root, &request)?;
    let rev = request.rev.as_deref().unwrap_or("HEAD");
    let head = head_ref(&repo);
    let result = match tree_for_rev(&repo, rev) {
        Ok(tree) => match tree.get_path(Path::new(&relative_path)) {
            Ok(entry) => match entry.to_object(&repo)?.peel_to_blob() {
                Ok(blob) => Some(String::from_utf8_lossy(blob.content()).into_owned()),
                Err(_) => None,
            },
            Err(error) if error.code() == ErrorCode::NotFound => None,
            Err(error) => return Err(error.into()),
        },
        Err(GitProviderError::NoHead) => None,
        Err(error) => return Err(error),
    };

    Ok(GitHeadBlobResult {
        dto: "GitHeadBlobResult",
        version: 1,
        root: repo_root_string(&repo, &root),
        relative_path,
        found: result.is_some(),
        content: result.map(GitTextPayload::utf8),
        head: head.map(|head| head.full),
    })
}

pub(crate) fn git_diff(request: GitProviderRequest) -> Result<GitDiffResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let base = request.base.clone().unwrap_or_else(|| "HEAD".to_owned());
    let requested_paths = relative_paths(&repo, &root, &request)?;
    let diff = build_diff(
        &repo,
        &base,
        request.cached.unwrap_or(false),
        requested_paths.as_deref(),
    )?;
    let paths = if let Some(paths) = requested_paths {
        paths
    } else {
        diff_delta_paths(&diff)
    };
    let mut files = Vec::new();
    for relative_path in &paths {
        let file_diff = build_diff(
            &repo,
            &base,
            request.cached.unwrap_or(false),
            Some(std::slice::from_ref(relative_path)),
        )?;
        let status = diff_status_for_path(&file_diff, relative_path);
        let suppression = diff_content_suppression(&file_diff, &status)?;
        let patch = if suppression.is_some() {
            String::new()
        } else {
            let patch = diff_patch_text(&file_diff)?;
            if patch.is_empty() {
                continue;
            }
            patch
        };
        files.push(GitDiffFile {
            relative_path: relative_path.clone(),
            status,
            patch: GitTextPayload::utf8(patch),
            content_suppressed: suppression.map(|_| true),
            suppressed_reason: suppression.map(|metadata| metadata.reason.to_owned()),
            display_text: suppression.map(|metadata| metadata.display_text.to_owned()),
            line_byte_limit: suppression.and_then(|metadata| metadata.line_byte_limit),
        });
    }

    Ok(GitDiffResult {
        dto: "GitDiffResult",
        version: 1,
        root: repo_root_string(&repo, &root),
        project_generation: request.project_generation,
        base,
        paths,
        files,
    })
}

pub(crate) fn git_diff_hunks(
    request: GitProviderRequest,
) -> Result<GitDiffHunks, GitProviderError> {
    let raw_root = request_root(&request)?;
    let base = request.base.clone().unwrap_or_else(|| "HEAD".to_owned());
    let Some(repo) = discover_repo(&raw_root)? else {
        let relative_path = single_relative_path_without_repo(&raw_root, &request)?;
        return Ok(GitDiffHunks {
            dto: "GitDiffHunks",
            version: 1,
            root: path_to_string(&raw_root),
            project_generation: request.project_generation,
            relative_path,
            base,
            hunks: Vec::new(),
            summary: diff_hunks_summary(0, 0, false, None, None),
        });
    };
    let relative_path = single_relative_path(&repo, &raw_root, &request)?;
    let diff = build_diff(
        &repo,
        &base,
        request.cached.unwrap_or(false),
        Some(std::slice::from_ref(&relative_path)),
    )?;
    let tracked = path_exists_in_tree(&repo, &base, &relative_path);
    let status = diff_status_for_path(&diff, &relative_path);
    let suppression = diff_content_suppression(&diff, &status)?;
    // Whole-file and minified-style diffs keep rows addressable without copying
    // pathological line bodies into Python or browser memory.
    let (hunks, added, deleted) = if suppression.is_some() {
        (Vec::new(), 0, 0)
    } else {
        diff_hunks_for_path(&diff)?
    };
    Ok(GitDiffHunks {
        dto: "GitDiffHunks",
        version: 1,
        root: repo_root_string(&repo, &raw_root),
        project_generation: request.project_generation,
        relative_path,
        base,
        hunks,
        summary: diff_hunks_summary(added, deleted, tracked, Some(status), suppression),
    })
}

pub(crate) fn git_stage(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let paths = required_relative_paths(&repo, &root, &request)?;
    let mut index = repo.index()?;
    let workdir = repo_workdir(&repo, &root);
    for path in &paths {
        let full_path = workdir.join(path);
        if full_path.exists() {
            index.add_all([path.as_str()], IndexAddOption::DEFAULT, None)?;
        } else {
            let _ = index.remove_path(Path::new(path));
        }
    }
    index.write()?;
    Ok(mutation_result(&repo, &root, "stage", paths))
}

pub(crate) fn git_unstage(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let paths = required_relative_paths(&repo, &root, &request)?;
    if let Ok(head) = repo.revparse_single("HEAD") {
        let path_refs = paths.iter().map(String::as_str).collect::<Vec<_>>();
        repo.reset_default(Some(&head), path_refs)?;
    } else {
        let mut index = repo.index()?;
        for path in &paths {
            let _ = index.remove_path(Path::new(path));
        }
        index.write()?;
    }
    Ok(mutation_result(&repo, &root, "unstage", paths))
}

pub(crate) fn git_restore(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let paths = required_relative_paths(&repo, &root, &request)?;
    let _ = repo
        .revparse_single("HEAD")
        .map_err(|_| GitProviderError::NoHead)?;
    if request.staged.unwrap_or(false) {
        let head = repo.revparse_single("HEAD")?;
        let path_refs = paths.iter().map(String::as_str).collect::<Vec<_>>();
        repo.reset_default(Some(&head), path_refs)?;
    }
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    for path in &paths {
        checkout.path(path);
    }
    repo.checkout_head(Some(&mut checkout))?;
    Ok(mutation_result(&repo, &root, "restore", paths))
}

pub(crate) fn git_reset_hard(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let target = request
        .target
        .as_deref()
        .or(request.rev.as_deref())
        .or(request.base.as_deref())
        .unwrap_or("HEAD");
    let object = repo.revparse_single(target)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.reset(&object, ResetType::Hard, Some(&mut checkout))?;
    Ok(mutation_result(&repo, &root, "resetHard", Vec::new()))
}

pub(crate) fn git_commit(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    if let Some(paths) = relative_paths(&repo, &root, &request)? {
        let mut staged_request = request.clone();
        staged_request.paths = Some(paths);
        git_stage(staged_request)?;
    }
    let message = required_text(request.message.as_deref(), GitProviderError::MissingMessage)?;
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo
        .signature()
        .or_else(|_| Signature::now("TE2", "te2@example.invalid"))?;
    let parents = head_commit(&repo)
        .map(|commit| vec![commit])
        .unwrap_or_default();
    let parent_refs = parents.iter().collect::<Vec<_>>();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parent_refs,
    )?;
    Ok(mutation_result(&repo, &root, "commit", Vec::new()))
}

pub(crate) fn git_branch_list(
    request: GitProviderRequest,
) -> Result<GitBranchList, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let current = current_branch(&repo);
    let mut branches = Vec::new();
    for branch_result in repo.branches(None)? {
        let (branch, branch_type) = branch_result?;
        let Some(name) = branch.name()?.map(str::to_owned) else {
            continue;
        };
        branches.push(GitBranchItem {
            current: branch_type == BranchType::Local && current.as_deref() == Some(name.as_str()),
            remote: branch_type == BranchType::Remote,
            name,
        });
    }
    branches.sort_by(|left, right| {
        left.remote
            .cmp(&right.remote)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(GitBranchList {
        dto: "GitBranchList",
        version: 1,
        root: repo_root_string(&repo, &root),
        current,
        branches,
    })
}

pub(crate) fn git_branch_checkout(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let name = required_text(
        request.name.as_deref().or(request.branch.as_deref()),
        GitProviderError::MissingName,
    )?;
    let (object, reference) = repo.revparse_ext(name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_tree(&object, Some(&mut checkout))?;
    if let Some(reference) = reference {
        let reference_name = reference.name().ok_or_else(|| {
            GitProviderError::Git(format!("branch reference has no valid name: {name}"))
        })?;
        repo.set_head(reference_name)?;
    } else if repo.find_branch(name, BranchType::Local).is_ok() {
        repo.set_head(&format!("refs/heads/{name}"))?;
    } else {
        repo.set_head_detached(object.id())?;
    }
    Ok(mutation_result(&repo, &root, "branchCheckout", Vec::new()))
}

pub(crate) fn git_branch_create(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let name = required_text(
        request.name.as_deref().or(request.branch.as_deref()),
        GitProviderError::MissingName,
    )?;
    let target = request.target.as_deref().unwrap_or("HEAD");
    let object = repo.revparse_single(target)?;
    let commit = object.peel_to_commit()?;
    repo.branch(name, &commit, request.force.unwrap_or(false))?;
    Ok(mutation_result(&repo, &root, "branchCreate", Vec::new()))
}

pub(crate) fn git_remote_list(
    request: GitProviderRequest,
) -> Result<GitRemoteList, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let mut remotes = Vec::new();
    for name in repo.remotes()?.iter().flatten() {
        let remote = repo.find_remote(name)?;
        remotes.push(GitRemoteItem {
            name: name.to_owned(),
            fetch_url: remote.url().map(str::to_owned),
            push_url: remote.pushurl().or(remote.url()).map(str::to_owned),
        });
    }
    remotes.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(GitRemoteList {
        dto: "GitRemoteList",
        version: 1,
        root: repo_root_string(&repo, &root),
        remotes,
    })
}

pub(crate) fn git_worktree_changes(
    request: GitProviderRequest,
) -> Result<GitWorktreeChanges, GitProviderError> {
    let root = request_root(&request)?;
    let base = request.base.clone().unwrap_or_else(|| "HEAD".to_owned());
    let Some(repo) = discover_repo(&root)? else {
        return Ok(GitWorktreeChanges {
            dto: "GitWorktreeChanges",
            version: 1,
            root: path_to_string(&root),
            project_generation: request.project_generation,
            base,
            is_repository: false,
            changes: Vec::new(),
            truncated: false,
        });
    };
    let limit = request.limit.unwrap_or(20_000).min(100_000);
    let mut options = StatusOptions::new();
    options
        .show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut options))?;
    let mut changes = Vec::new();
    let mut truncated = false;
    for entry in statuses.iter() {
        if changes.len() >= limit {
            truncated = true;
            break;
        }
        let status = entry.status();
        if status.contains(Status::IGNORED) || status.is_empty() || status == Status::CURRENT {
            continue;
        }
        let Some(path) = status_path(&entry) else {
            continue;
        };
        changes.push(GitWorktreeChange {
            path,
            code: status_short_code(status).to_owned(),
            original_path: status_original_path(&entry),
        });
    }
    Ok(GitWorktreeChanges {
        dto: "GitWorktreeChanges",
        version: 1,
        root: repo_root_string(&repo, &root),
        project_generation: request.project_generation,
        base,
        is_repository: true,
        changes,
        truncated,
    })
}

pub(crate) fn git_path_index(
    request: GitProviderRequest,
) -> Result<GitPathIndex, GitProviderError> {
    let root = request_root(&request)?;
    let Some(repo) = discover_repo(&root)? else {
        return Ok(GitPathIndex {
            dto: "GitPathIndex",
            version: 1,
            root: path_to_string(&root),
            project_generation: request.project_generation,
            is_repository: false,
            paths: Vec::new(),
            source: "not-repository",
            truncated: false,
        });
    };
    let limit = request.limit.unwrap_or(50_000).min(250_000);
    let mut paths = BTreeSet::new();
    let index = repo.index()?;
    for entry in index.iter() {
        paths.insert(String::from_utf8_lossy(&entry.path).into_owned());
        if paths.len() >= limit {
            break;
        }
    }
    let mut options = StatusOptions::new();
    options
        .show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut options))?;
    let mut truncated = paths.len() >= limit;
    for entry in statuses.iter() {
        if paths.len() >= limit {
            truncated = true;
            break;
        }
        let status = entry.status();
        if status.contains(Status::WT_NEW)
            && let Some(path) = status_path(&entry)
        {
            paths.insert(path);
        }
    }
    Ok(GitPathIndex {
        dto: "GitPathIndex",
        version: 1,
        root: repo_root_string(&repo, &root),
        project_generation: request.project_generation,
        is_repository: true,
        paths: paths.into_iter().collect(),
        source: "git-index",
        truncated,
    })
}

pub(crate) fn git_commit_info(
    request: GitProviderRequest,
) -> Result<GitCommitInfoResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let rev = request
        .rev
        .as_deref()
        .or(request.base.as_deref())
        .unwrap_or("HEAD");
    let commit = match repo.revparse_single(rev) {
        Ok(object) => match object.peel_to_commit() {
            Ok(commit) => Some(commit),
            Err(_) => None,
        },
        Err(error) if error.code() == ErrorCode::NotFound => None,
        Err(error) if error.code() == ErrorCode::InvalidSpec => None,
        Err(error) => return Err(error.into()),
    };
    let commit = commit.map(|commit| {
        let oid = commit.id().to_string();
        let author = commit.author();
        GitCommitInfo {
            short_hash: short_oid(&oid),
            hash: oid,
            summary: commit.summary().map(str::to_owned),
            author: author.name().map(str::to_owned),
            date: format_git_time(commit.time()),
        }
    });
    Ok(GitCommitInfoResult {
        dto: "GitCommitInfoResult",
        version: 1,
        root: repo_root_string(&repo, &root),
        project_generation: request.project_generation,
        found: commit.is_some(),
        commit,
    })
}

pub(crate) fn git_remote_add(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let name = required_text(
        request
            .remote_name
            .as_deref()
            .or(request.remote.as_deref())
            .or(request.name.as_deref()),
        GitProviderError::MissingName,
    )?;
    let fetch_url = required_text(
        request.fetch_url.as_deref().or(request.url.as_deref()),
        GitProviderError::MissingUrl,
    )?;
    repo.remote(name, fetch_url)?;
    if let Some(push_url) = request
        .push_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        repo.remote_set_pushurl(name, Some(push_url))?;
    }
    Ok(mutation_result(&repo, &root, "remoteAdd", Vec::new()))
}

pub(crate) fn git_history(
    request: GitProviderRequest,
) -> Result<GitHistoryResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let path_filter = optional_relative_path(&repo, &root, &request)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head().map_err(|_| GitProviderError::NoHead)?;
    let limit = request.limit.unwrap_or(100).min(500);
    let mut commits = Vec::new();
    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        if let Some(path) = path_filter.as_deref() {
            if !commit_touches_path(&repo, &commit, path)? {
                continue;
            }
        }
        let author = commit.author();
        let full = oid.to_string();
        commits.push(GitHistoryCommit {
            short: short_oid(&full),
            id: full,
            summary: commit.summary().map(str::to_owned),
            author_name: author.name().map(str::to_owned),
            author_email: author.email().map(str::to_owned),
            time: commit.time().seconds(),
        });
        if commits.len() >= limit {
            break;
        }
    }
    Ok(GitHistoryResult {
        dto: "GitHistoryResult",
        version: 1,
        root: repo_root_string(&repo, &root),
        project_generation: request.project_generation,
        commits,
    })
}

pub(crate) fn git_init(request: GitProviderRequest) -> Result<GitMutationResult, GitProviderError> {
    let root = request_root(&request)?;
    fs::create_dir_all(&root)?;
    let repo = Repository::init(&root)?;
    Ok(mutation_result(&repo, &root, "init", Vec::new()))
}

pub(crate) fn git_clone(
    request: GitProviderRequest,
) -> Result<GitMutationResult, GitProviderError> {
    git_clone_with_progress(request, |_| true)
}

pub(crate) fn git_clone_with_progress<F>(
    request: GitProviderRequest,
    progress: F,
) -> Result<GitMutationResult, GitProviderError>
where
    F: FnMut(GitOperationProgress) -> bool,
{
    let url = required_text(request.url.as_deref(), GitProviderError::MissingUrl)?;
    let destination = request
        .destination
        .as_deref()
        .or(request.path.as_deref())
        .or(request.root.as_deref())
        .filter(|value| !value.trim().is_empty())
        .ok_or(GitProviderError::MissingDestination)?;
    let destination = normalize_existing_path(destination);
    let progress = Arc::new(StdMutex::new(progress));
    let mut callbacks = RemoteCallbacks::new();
    install_configured_git_credentials(&mut callbacks, Some(url.to_owned()));
    let transfer_progress = Arc::clone(&progress);
    callbacks.transfer_progress(move |stats| {
        emit_operation_progress(
            &transfer_progress,
            GitOperationProgress {
                phase: "fetch",
                completed: stats.received_objects().max(stats.indexed_objects()) as u64,
                total: stats.total_objects() as u64,
                detail: format!(
                    "received {} of {} objects ({} bytes)",
                    stats.received_objects(),
                    stats.total_objects(),
                    stats.received_bytes()
                ),
            },
        )
    });
    let sideband_progress = Arc::clone(&progress);
    callbacks.sideband_progress(move |bytes| {
        let detail = String::from_utf8_lossy(bytes).trim().to_owned();
        if detail.is_empty() {
            return true;
        }
        emit_operation_progress(
            &sideband_progress,
            GitOperationProgress {
                phase: "remote",
                completed: 0,
                total: 0,
                detail,
            },
        )
    });
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    if let Some(depth) = request.depth {
        fetch_options.depth(depth.min(i32::MAX as usize) as i32);
    }

    let checkout_progress = Arc::clone(&progress);
    let mut checkout = CheckoutBuilder::new();
    checkout.progress(move |path, completed, total| {
        let detail = path
            .map(path_to_string)
            .unwrap_or_else(|| "checkout".to_owned());
        let _ = emit_operation_progress(
            &checkout_progress,
            GitOperationProgress {
                phase: "checkout",
                completed: completed as u64,
                total: total as u64,
                detail,
            },
        );
    });

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_options);
    builder.with_checkout(checkout);
    if let Some(branch) = request
        .branch
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        builder.branch(branch);
    }
    let repo = builder.clone(url, &destination)?;
    Ok(mutation_result(&repo, &destination, "clone", Vec::new()))
}

pub(crate) fn git_pull(request: GitProviderRequest) -> Result<GitMutationResult, GitProviderError> {
    git_pull_with_progress(request, |_| true)
}

pub(crate) fn git_pull_with_progress<F>(
    request: GitProviderRequest,
    progress: F,
) -> Result<GitMutationResult, GitProviderError>
where
    F: FnMut(GitOperationProgress) -> bool,
{
    let (repo, root) = repo_from_request(&request)?;
    let remote_name = request.remote.as_deref().unwrap_or("origin");
    let branch = request
        .branch
        .clone()
        .or_else(|| current_branch(&repo))
        .ok_or(GitProviderError::NoHead)?;
    let progress = Arc::new(StdMutex::new(progress));
    let mut callbacks = RemoteCallbacks::new();
    install_configured_git_credentials(&mut callbacks, None);
    let transfer_progress = Arc::clone(&progress);
    callbacks.transfer_progress(move |stats| {
        emit_operation_progress(
            &transfer_progress,
            GitOperationProgress {
                phase: "fetch",
                completed: stats.received_objects().max(stats.indexed_objects()) as u64,
                total: stats.total_objects() as u64,
                detail: format!(
                    "received {} of {} objects ({} bytes)",
                    stats.received_objects(),
                    stats.total_objects(),
                    stats.received_bytes()
                ),
            },
        )
    });
    let sideband_progress = Arc::clone(&progress);
    callbacks.sideband_progress(move |bytes| {
        let detail = String::from_utf8_lossy(bytes).trim().to_owned();
        if detail.is_empty() {
            return true;
        }
        emit_operation_progress(
            &sideband_progress,
            GitOperationProgress {
                phase: "remote",
                completed: 0,
                total: 0,
                detail,
            },
        )
    });
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    if let Some(depth) = request.depth {
        fetch_options.depth(depth.min(i32::MAX as usize) as i32);
    }
    let mut remote = repo.find_remote(remote_name)?;
    remote.fetch(&[branch.as_str()], Some(&mut fetch_options), None)?;
    let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
    let remote_oid = repo.refname_to_id(&remote_ref)?;
    let annotated = repo.find_annotated_commit(remote_oid)?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;
    if analysis.is_up_to_date() {
        return Ok(mutation_result(&repo, &root, "pull", Vec::new()));
    }
    if !analysis.is_fast_forward() {
        return Err(GitProviderError::Unsupported(
            "non-fast-forward pull is not implemented in the TE2 Git provider".to_owned(),
        ));
    }
    if !emit_operation_progress(
        &progress,
        GitOperationProgress {
            phase: "merge",
            completed: 1,
            total: 1,
            detail: "fast-forward".to_owned(),
        },
    ) {
        return Err(GitProviderError::Git("git job cancelled".to_owned()));
    }
    fast_forward(&repo, &branch, remote_oid)?;
    Ok(mutation_result(&repo, &root, "pull", Vec::new()))
}

pub(crate) fn git_push(request: GitProviderRequest) -> Result<GitMutationResult, GitProviderError> {
    git_push_with_progress(request, |_| true)
}

pub(crate) fn git_push_with_progress<F>(
    request: GitProviderRequest,
    progress: F,
) -> Result<GitMutationResult, GitProviderError>
where
    F: FnMut(GitOperationProgress) -> bool,
{
    let (repo, root) = repo_from_request(&request)?;
    let remote_name = request.remote.as_deref().unwrap_or("origin");
    let branch = request
        .branch
        .clone()
        .or_else(|| current_branch(&repo))
        .ok_or(GitProviderError::NoHead)?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let progress = Arc::new(StdMutex::new(progress));
    let mut callbacks = RemoteCallbacks::new();
    install_configured_git_credentials(&mut callbacks, None);
    let negotiation_progress = Arc::clone(&progress);
    callbacks.push_negotiation(move |_| {
        if emit_operation_progress(
            &negotiation_progress,
            GitOperationProgress {
                phase: "negotiate",
                completed: 0,
                total: 0,
                detail: "negotiating push updates".to_owned(),
            },
        ) {
            Ok(())
        } else {
            Err(git2::Error::from_str("git job cancelled"))
        }
    });
    let transfer_progress = Arc::clone(&progress);
    callbacks.push_transfer_progress(move |current, total, bytes| {
        let _ = emit_operation_progress(
            &transfer_progress,
            GitOperationProgress {
                phase: "push",
                completed: current as u64,
                total: total as u64,
                detail: format!("pushed {current} of {total} objects ({bytes} bytes)"),
            },
        );
    });
    let update_progress = Arc::clone(&progress);
    callbacks.push_update_reference(move |reference, status| {
        let detail = match status {
            Some(status) => format!("{reference}: {status}"),
            None => format!("{reference}: updated"),
        };
        let _ = emit_operation_progress(
            &update_progress,
            GitOperationProgress {
                phase: "update",
                completed: 1,
                total: 1,
                detail,
            },
        );
        if let Some(status) = status {
            Err(git2::Error::from_str(status))
        } else {
            Ok(())
        }
    });
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    push_options.packbuilder_parallelism(0);
    let mut remote = repo.find_remote(remote_name)?;
    remote.push(&[refspec.as_str()], Some(&mut push_options))?;
    Ok(mutation_result(&repo, &root, "push", Vec::new()))
}

fn emit_operation_progress<F>(progress: &Arc<StdMutex<F>>, update: GitOperationProgress) -> bool
where
    F: FnMut(GitOperationProgress) -> bool,
{
    match progress.lock() {
        Ok(mut progress) => progress(update),
        Err(_) => false,
    }
}

fn install_configured_git_credentials(
    callbacks: &mut RemoteCallbacks<'_>,
    operation_url: Option<String>,
) {
    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.is_ssh_key() {
            let username = username_from_url
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("git");
            if let Ok(credential) = Cred::ssh_key_from_agent(username) {
                return Ok(credential);
            }
        }

        if allowed.is_user_pass_plaintext() {
            if let Ok(config) = Config::open_default() {
                if let Ok(credential) = Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(credential);
                }
                if let Some(operation_url) = operation_url
                    .as_deref()
                    .filter(|operation_url| !operation_url.is_empty() && *operation_url != url)
                    && let Ok(credential) =
                        Cred::credential_helper(&config, operation_url, username_from_url)
                {
                    return Ok(credential);
                }
            }
        }

        if allowed.is_username() {
            let username = username_from_url
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("git");
            return Cred::username(username);
        }

        if allowed.is_default()
            && let Ok(credential) = Cred::default()
        {
            return Ok(credential);
        }

        Err(git2::Error::from_str(
            "no configured git credential matched remote authentication request",
        ))
    });
}

fn git_summary_for_path(raw_path: &str) -> GitSummaryData {
    let target_path = normalize_git_path(raw_path);
    let repo = match discover_repo(&target_path) {
        Ok(Some(repo)) => repo,
        Ok(None) => return GitSummaryData::not_repo(),
        Err(error) => return GitSummaryData::error(false, error.message().to_owned()),
    };

    let branch = current_branch(&repo);
    let head = head_ref(&repo);
    let summary = head_commit_summary(&repo);
    GitSummaryData {
        is_repo: true,
        branch,
        head_hash: head.as_ref().map(|head| head.full.clone()),
        head_short: head.as_ref().map(|head| head.short.clone()),
        summary,
        error: None,
    }
}

fn git_snapshot_for_root(
    root: PathBuf,
    project_generation: Option<u64>,
    include_status: bool,
    include_decorations: bool,
    untracked_mode: &str,
) -> GitSnapshot {
    let root_string = path_to_string(&root);
    let repo = match discover_repo(&root) {
        Ok(Some(repo)) => repo,
        Ok(None) | Err(_) => return empty_snapshot(root_string, project_generation),
    };

    let head = head_ref(&repo);
    let has_head = head.is_some();
    let (branch, detached) = branch_and_detached(&repo);
    let (ahead, behind) = ahead_behind(&repo);
    let status_snapshot = if include_status || include_decorations {
        collect_status_snapshot(&repo, untracked_mode)
    } else {
        GitStatusSnapshot::default()
    };

    GitSnapshot {
        dto: "GitSnapshot",
        version: 1,
        root: root_string.clone(),
        project_path: root_string,
        project_generation,
        is_repository: true,
        has_head,
        branch,
        detached,
        head,
        ahead,
        behind,
        staged: if include_status {
            status_snapshot.staged
        } else {
            Vec::new()
        },
        unstaged: if include_status {
            status_snapshot.unstaged
        } else {
            Vec::new()
        },
        untracked: if include_status {
            status_snapshot.untracked
        } else {
            Vec::new()
        },
        statuses: if include_decorations {
            status_snapshot.statuses
        } else {
            BTreeMap::new()
        },
    }
}

fn empty_snapshot(root: String, project_generation: Option<u64>) -> GitSnapshot {
    GitSnapshot {
        dto: "GitSnapshot",
        version: 1,
        root: root.clone(),
        project_path: root,
        project_generation,
        is_repository: false,
        has_head: false,
        branch: None,
        detached: false,
        head: None,
        ahead: 0,
        behind: 0,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        statuses: BTreeMap::new(),
    }
}

fn request_root(request: &GitProviderRequest) -> Result<PathBuf, GitProviderError> {
    let Some(raw_root) = request
        .root
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    else {
        return Err(GitProviderError::MissingRoot);
    };
    Ok(normalize_existing_path(raw_root))
}

fn repo_from_request(
    request: &GitProviderRequest,
) -> Result<(Repository, PathBuf), GitProviderError> {
    let root = request_root(request)?;
    let repo = discover_repo(&root)?.ok_or(GitProviderError::NotRepository)?;
    Ok((repo, root))
}

fn repo_workdir(repo: &Repository, fallback: &Path) -> PathBuf {
    repo.workdir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| fallback.to_path_buf())
}

fn repo_root_string(repo: &Repository, fallback: &Path) -> String {
    path_to_string(repo_workdir(repo, fallback).as_path())
}

fn normalize_git_path(raw_path: &str) -> PathBuf {
    let mut target_path = normalize_existing_path(raw_path);
    if target_path.is_file() {
        if let Some(parent) = target_path.parent() {
            target_path = parent.to_path_buf();
        }
    }
    target_path
}

fn normalize_existing_path(raw_path: &str) -> PathBuf {
    let target_path = normalize_lexical(expand_user_path(raw_path.trim(), &home_dir()));
    fs::canonicalize(&target_path).unwrap_or(target_path)
}

fn discover_repo(path: &Path) -> Result<Option<Repository>, git2::Error> {
    match Repository::discover(path) {
        Ok(repo) => Ok(Some(repo)),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn single_relative_path(
    repo: &Repository,
    root: &Path,
    request: &GitProviderRequest,
) -> Result<String, GitProviderError> {
    optional_relative_path(repo, root, request)?.ok_or(GitProviderError::MissingPath)
}

fn optional_relative_path(
    repo: &Repository,
    root: &Path,
    request: &GitProviderRequest,
) -> Result<Option<String>, GitProviderError> {
    let Some(raw_path) = request
        .relative_path
        .as_deref()
        .or(request.path.as_deref())
        .filter(|path| !path.trim().is_empty())
    else {
        return Ok(None);
    };
    Ok(Some(normalize_repo_relative_path(repo, root, raw_path)?))
}

fn relative_paths(
    repo: &Repository,
    root: &Path,
    request: &GitProviderRequest,
) -> Result<Option<Vec<String>>, GitProviderError> {
    if let Some(paths) = request.paths.as_ref() {
        let mut normalized = Vec::new();
        for path in paths {
            if path.trim().is_empty() {
                continue;
            }
            normalized.push(normalize_repo_relative_path(repo, root, path)?);
        }
        return Ok(Some(normalized));
    }
    optional_relative_path(repo, root, request).map(|path| path.map(|path| vec![path]))
}

fn required_relative_paths(
    repo: &Repository,
    root: &Path,
    request: &GitProviderRequest,
) -> Result<Vec<String>, GitProviderError> {
    let paths = relative_paths(repo, root, request)?.ok_or(GitProviderError::MissingPaths)?;
    if paths.is_empty() {
        return Err(GitProviderError::MissingPaths);
    }
    Ok(paths)
}

fn normalize_repo_relative_path(
    repo: &Repository,
    root: &Path,
    raw_path: &str,
) -> Result<String, GitProviderError> {
    let raw = raw_path.trim();
    let workdir = repo_workdir(repo, root);
    let path = if raw == "~" || raw.starts_with("~/") || raw.starts_with('/') {
        expand_user_path(raw, &home_dir())
    } else {
        PathBuf::from(raw)
    };
    let relative = if path.is_absolute() {
        let normalized = normalize_lexical(path);
        normalized
            .strip_prefix(&workdir)
            .or_else(|_| normalized.strip_prefix(root))
            .map(Path::to_path_buf)
            .map_err(|_| GitProviderError::InvalidPath(raw.to_owned()))?
    } else {
        PathBuf::from(raw)
    };
    let normalized = normalize_relative_components(&relative)
        .ok_or_else(|| GitProviderError::InvalidPath(raw.to_owned()))?;
    Ok(path_to_string(&normalized))
}

fn normalize_relative_components(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

fn required_text<'a>(
    value: Option<&'a str>,
    error: GitProviderError,
) -> Result<&'a str, GitProviderError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(error)
}

fn tree_for_rev<'repo>(
    repo: &'repo Repository,
    rev: &str,
) -> Result<git2::Tree<'repo>, GitProviderError> {
    let object = repo
        .revparse_single(rev)
        .or_else(|_| repo.revparse_single("HEAD"))
        .map_err(|_| GitProviderError::NoHead)?;
    Ok(object.peel_to_tree()?)
}

fn optional_tree_for_rev<'repo>(
    repo: &'repo Repository,
    rev: &str,
) -> Result<Option<git2::Tree<'repo>>, GitProviderError> {
    match tree_for_rev(repo, rev) {
        Ok(tree) => Ok(Some(tree)),
        Err(GitProviderError::NoHead) => Ok(None),
        Err(error) => Err(error),
    }
}

fn build_diff<'repo>(
    repo: &'repo Repository,
    base: &str,
    cached: bool,
    paths: Option<&[String]>,
) -> Result<Diff<'repo>, GitProviderError> {
    let mut options = DiffOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    if let Some(paths) = paths {
        for path in paths {
            options.pathspec(path);
        }
    }
    let base_tree = optional_tree_for_rev(repo, base)?;
    if cached {
        let index = repo.index()?;
        Ok(repo.diff_tree_to_index(base_tree.as_ref(), Some(&index), Some(&mut options))?)
    } else if base_tree.is_some() {
        Ok(repo.diff_tree_to_workdir_with_index(base_tree.as_ref(), Some(&mut options))?)
    } else {
        Ok(repo.diff_index_to_workdir(None, Some(&mut options))?)
    }
}

fn diff_delta_paths(diff: &Diff<'_>) -> Vec<String> {
    let mut paths = BTreeSet::new();
    for delta in diff.deltas() {
        if let Some(path) = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(path_to_string)
        {
            paths.insert(path);
        }
    }
    paths.into_iter().collect()
}

fn diff_patch_text(diff: &Diff<'_>) -> Result<String, GitProviderError> {
    let mut patch = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        patch.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;
    Ok(patch)
}

const MAX_DIFF_LINE_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy)]
struct DiffContentSuppression {
    reason: &'static str,
    display_text: &'static str,
    line_byte_limit: Option<usize>,
}

fn diff_content_suppression(
    diff: &Diff<'_>,
    status: &str,
) -> Result<Option<DiffContentSuppression>, GitProviderError> {
    match status {
        "deleted" => {
            return Ok(Some(DiffContentSuppression {
                reason: "wholeFileStatusOnly",
                display_text: "Deleted file",
                line_byte_limit: None,
            }));
        }
        "untracked" => {
            return Ok(Some(DiffContentSuppression {
                reason: "wholeFileStatusOnly",
                display_text: "Untracked file",
                line_byte_limit: None,
            }));
        }
        _ => {}
    }
    if diff_contains_oversized_body_line(diff)? {
        return Ok(Some(DiffContentSuppression {
            reason: "oversizedDiffLine",
            display_text: "Diff omitted: contains a line over 8 KB",
            line_byte_limit: Some(MAX_DIFF_LINE_BYTES),
        }));
    }
    Ok(None)
}

fn diff_contains_oversized_body_line(diff: &Diff<'_>) -> Result<bool, GitProviderError> {
    let mut oversized = false;
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '>' | '-' | '<' | ' ' | '=')
            && line.content().len() > MAX_DIFF_LINE_BYTES
        {
            oversized = true;
        }
        true
    })?;
    Ok(oversized)
}

fn diff_hunks_summary(
    added: usize,
    deleted: usize,
    tracked: bool,
    status: Option<String>,
    suppression: Option<DiffContentSuppression>,
) -> GitDiffHunksSummary {
    GitDiffHunksSummary {
        added,
        deleted,
        tracked,
        status,
        content_suppressed: suppression.map(|_| true),
        suppressed_reason: suppression.map(|metadata| metadata.reason.to_owned()),
        display_text: suppression.map(|metadata| metadata.display_text.to_owned()),
        line_byte_limit: suppression.and_then(|metadata| metadata.line_byte_limit),
    }
}

fn diff_hunks_for_path(
    diff: &Diff<'_>,
) -> Result<(Vec<GitDiffHunk>, usize, usize), GitProviderError> {
    let mut hunks = Vec::<GitDiffHunk>::new();
    let mut added = 0usize;
    let mut deleted = 0usize;
    diff.print(DiffFormat::Patch, |_delta, hunk, line| {
        if let Some(hunk) = hunk {
            let should_start_hunk = hunks
                .last()
                .map(|current| {
                    current.old_start != hunk.old_start() || current.new_start != hunk.new_start()
                })
                .unwrap_or(true);
            if should_start_hunk {
                hunks.push(GitDiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                });
            }
        }
        let origin = line.origin();
        let line_type = match origin {
            '+' | '>' => {
                added += 1;
                "add"
            }
            '-' | '<' => {
                deleted += 1;
                "del"
            }
            ' ' | '=' => "context",
            _ => return true,
        };
        if let Some(current) = hunks.last_mut() {
            current.lines.push(GitDiffHunkLine {
                line_type: line_type.to_owned(),
                text: String::from_utf8_lossy(line.content())
                    .trim_end_matches(['\r', '\n'])
                    .to_owned(),
            });
        }
        true
    })?;
    Ok((hunks, added, deleted))
}

fn path_exists_in_tree(repo: &Repository, rev: &str, relative_path: &str) -> bool {
    tree_for_rev(repo, rev)
        .and_then(|tree| match tree.get_path(Path::new(relative_path)) {
            Ok(_) => Ok(tree),
            Err(error) if error.code() == ErrorCode::NotFound => Err(GitProviderError::MissingPath),
            Err(error) => Err(error.into()),
        })
        .is_ok()
}

fn diff_status_for_path(diff: &Diff<'_>, relative_path: &str) -> String {
    for delta in diff.deltas() {
        let delta_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(path_to_string);
        if delta_path.as_deref() == Some(relative_path) {
            return diff_delta_status(delta.status()).to_owned();
        }
    }
    "modified".to_owned()
}

fn diff_delta_status(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        Delta::Conflicted => "conflict",
        Delta::Untracked => "untracked",
        Delta::Ignored => "ignored",
        _ => "modified",
    }
}

fn single_relative_path_without_repo(
    root: &Path,
    request: &GitProviderRequest,
) -> Result<String, GitProviderError> {
    let raw_path = request
        .relative_path
        .as_deref()
        .or(request.path.as_deref())
        .filter(|path| !path.trim().is_empty())
        .ok_or(GitProviderError::MissingPath)?;
    let raw = raw_path.trim();
    let path = if raw == "~" || raw.starts_with("~/") || raw.starts_with('/') {
        expand_user_path(raw, &home_dir())
    } else {
        PathBuf::from(raw)
    };
    let relative = if path.is_absolute() {
        let normalized = normalize_lexical(path);
        normalized
            .strip_prefix(root)
            .map(Path::to_path_buf)
            .map_err(|_| GitProviderError::InvalidPath(raw.to_owned()))?
    } else {
        path
    };
    let normalized = normalize_relative_components(&relative)
        .ok_or_else(|| GitProviderError::InvalidPath(raw.to_owned()))?;
    Ok(path_to_string(&normalized))
}

fn mutation_result(
    repo: &Repository,
    root: &Path,
    operation: impl Into<String>,
    changed_paths: Vec<String>,
) -> GitMutationResult {
    GitMutationResult {
        dto: "GitMutationResult",
        version: 1,
        root: repo_root_string(repo, root),
        operation: operation.into(),
        ok: true,
        changed_paths,
        status_invalidated: true,
    }
}

fn branch_and_detached(repo: &Repository) -> (Option<String>, bool) {
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            return (head.shorthand().map(str::to_owned), false);
        }
        if let Some(oid) = head.target() {
            return (Some(short_oid(&oid.to_string())), true);
        }
    }
    if let Ok(head) = repo.find_reference("HEAD") {
        if let Some(target) = head.symbolic_target() {
            return (Some(short_branch_name(target)), false);
        }
    }
    (None, false)
}

fn current_branch(repo: &Repository) -> Option<String> {
    branch_and_detached(repo).0
}

fn head_ref(repo: &Repository) -> Option<GitHeadRef> {
    let head = repo.head().ok()?;
    let oid = head.target()?;
    let full = oid.to_string();
    Some(GitHeadRef {
        short: short_oid(&full),
        full,
    })
}

fn head_commit(repo: &Repository) -> Option<git2::Commit<'_>> {
    let head = repo.head().ok()?;
    let oid = head.target()?;
    repo.find_commit(oid).ok()
}

fn head_commit_summary(repo: &Repository) -> Option<String> {
    head_commit(repo)?.summary().map(str::to_owned)
}

fn ahead_behind(repo: &Repository) -> (usize, usize) {
    let Ok(head) = repo.head() else {
        return (0, 0);
    };
    let Some(branch_name) = head.shorthand() else {
        return (0, 0);
    };
    let Ok(branch) = repo.find_branch(branch_name, BranchType::Local) else {
        return (0, 0);
    };
    let Ok(upstream) = branch.upstream() else {
        return (0, 0);
    };
    let Some(local_oid) = branch.get().target() else {
        return (0, 0);
    };
    let Some(upstream_oid) = upstream.get().target() else {
        return (0, 0);
    };
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
}

fn fast_forward(repo: &Repository, branch: &str, target: Oid) -> Result<(), GitProviderError> {
    let head_oid = repo.head()?.target().ok_or(GitProviderError::NoHead)?;
    let changed_paths = changed_paths_between(repo, head_oid, target)?;
    let conflicts = local_changes_overlapping(repo, &changed_paths);
    if !conflicts.is_empty() {
        return Err(GitProviderError::LocalChangesWouldBeOverwritten(conflicts));
    }

    let refname = format!("refs/heads/{branch}");
    match repo.find_reference(&refname) {
        Ok(mut reference) => {
            reference.set_target(target, "Fast-Forward")?;
        }
        Err(_) => {
            repo.reference(&refname, target, true, "Fast-Forward")?;
        }
    }
    repo.set_head(&refname)?;
    if changed_paths.is_empty() {
        return Ok(());
    }
    let mut checkout = CheckoutBuilder::new();
    // libgit2 needs a forced checkout to materialize fast-forward updates, so
    // scope it to paths already proven not to overlap local changes.
    checkout.force();
    for path in changed_paths {
        checkout.path(path.as_str());
    }
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn changed_paths_between(
    repo: &Repository,
    local_oid: Oid,
    target_oid: Oid,
) -> Result<BTreeSet<String>, GitProviderError> {
    let local_tree = repo.find_commit(local_oid)?.tree()?;
    let target_tree = repo.find_commit(target_oid)?.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&local_tree), Some(&target_tree), None)?;
    let mut paths = BTreeSet::new();
    for delta in diff.deltas() {
        if let Some(path) = delta.old_file().path() {
            paths.insert(path_to_string(path));
        }
        if let Some(path) = delta.new_file().path() {
            paths.insert(path_to_string(path));
        }
    }
    Ok(paths)
}

fn local_changes_overlapping(repo: &Repository, candidate_paths: &BTreeSet<String>) -> Vec<String> {
    if candidate_paths.is_empty() {
        return Vec::new();
    }
    let status = collect_status_snapshot(repo, "normal");
    let mut conflicts = BTreeSet::new();
    for path in status
        .staged
        .iter()
        .chain(status.unstaged.iter())
        .chain(status.untracked.iter())
    {
        if candidate_paths.contains(path) {
            conflicts.insert(path.clone());
        }
    }
    conflicts.into_iter().collect()
}

fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    relative_path: &str,
) -> Result<bool, GitProviderError> {
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let mut options = DiffOptions::new();
    options.pathspec(relative_path);
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))?;
    Ok(diff.deltas().len() > 0)
}

#[derive(Default)]
struct GitStatusSnapshot {
    staged: Vec<String>,
    unstaged: Vec<String>,
    untracked: Vec<String>,
    statuses: BTreeMap<String, String>,
}

fn collect_status_snapshot(repo: &Repository, untracked_mode: &str) -> GitStatusSnapshot {
    let mut options = StatusOptions::new();
    options
        .show(StatusShow::IndexAndWorkdir)
        .include_untracked(untracked_mode != "none")
        .recurse_untracked_dirs(untracked_mode != "none")
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = match repo.statuses(Some(&mut options)) {
        Ok(statuses) => statuses,
        Err(_) => return GitStatusSnapshot::default(),
    };

    let mut staged = BTreeSet::new();
    let mut unstaged = BTreeSet::new();
    let mut untracked = BTreeSet::new();
    let mut status_map = BTreeMap::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let Some(path) = status_path(&entry) else {
            continue;
        };
        let mapped = map_git_status(status);
        if mapped != "clean" {
            status_map.insert(path.clone(), mapped.to_owned());
        }
        if is_index_status(status) {
            staged.insert(path.clone());
        }
        if status.contains(Status::WT_NEW) {
            untracked.insert(path.clone());
        } else if is_worktree_status(status) {
            unstaged.insert(path);
        }
    }

    GitStatusSnapshot {
        staged: staged.into_iter().collect(),
        unstaged: unstaged.into_iter().collect(),
        untracked: untracked.into_iter().collect(),
        statuses: status_map,
    }
}

fn status_path(entry: &git2::StatusEntry<'_>) -> Option<String> {
    entry
        .head_to_index()
        .and_then(|delta| delta.new_file().path().or_else(|| delta.old_file().path()))
        .or_else(|| {
            entry
                .index_to_workdir()
                .and_then(|delta| delta.new_file().path().or_else(|| delta.old_file().path()))
        })
        .map(path_to_string)
}

fn status_original_path(entry: &git2::StatusEntry<'_>) -> Option<String> {
    entry
        .head_to_index()
        .and_then(|delta| delta.old_file().path())
        .or_else(|| {
            entry
                .index_to_workdir()
                .and_then(|delta| delta.old_file().path())
        })
        .map(path_to_string)
        .filter(|path| status_path(entry).as_deref() != Some(path.as_str()))
}

fn status_short_code(status: Status) -> &'static str {
    if status.contains(Status::WT_NEW) {
        return "??";
    }
    if status.intersects(Status::INDEX_RENAMED | Status::WT_RENAMED) {
        return "R";
    }
    if status.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
        return "D";
    }
    if status.contains(Status::INDEX_NEW) {
        return "A";
    }
    if status.contains(Status::CONFLICTED) {
        return "U";
    }
    if status.intersects(Status::INDEX_MODIFIED | Status::WT_MODIFIED) {
        return "M";
    }
    if status.intersects(Status::INDEX_TYPECHANGE | Status::WT_TYPECHANGE) {
        return "T";
    }
    "M"
}

fn map_git_status(status: Status) -> &'static str {
    if status.contains(Status::CONFLICTED) {
        return "conflict";
    }
    if status.contains(Status::IGNORED) {
        return "ignored";
    }
    if status.contains(Status::WT_NEW) {
        return "untracked";
    }
    if status.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
        return "deleted";
    }
    if status.intersects(Status::INDEX_RENAMED | Status::WT_RENAMED) {
        return "renamed";
    }
    if status.contains(Status::INDEX_NEW) {
        return "added";
    }
    let index = is_index_status(status);
    let worktree = is_worktree_status(status);
    if index && worktree {
        return "staged_modified";
    }
    if index {
        return "staged";
    }
    if worktree {
        return "modified";
    }
    "clean"
}

fn is_index_status(status: Status) -> bool {
    status.intersects(
        Status::INDEX_NEW
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE,
    )
}

fn is_worktree_status(status: Status) -> bool {
    status.intersects(
        Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
    )
}

fn short_oid(full: &str) -> String {
    full.chars().take(7).collect()
}

fn short_branch_name(reference_name: &str) -> String {
    reference_name
        .strip_prefix("refs/heads/")
        .unwrap_or(reference_name)
        .to_owned()
}

fn format_git_time(time: git2::Time) -> String {
    let sign = if time.offset_minutes() < 0 { '-' } else { '+' };
    let offset = time.offset_minutes().abs();
    let hours = offset / 60;
    let minutes = offset % 60;
    format!("{}{}{:02}:{:02}", time.seconds(), sign, hours, minutes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("te2-server-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn commit_all(repo: &Repository, message: &str) {
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

    fn provider_request(root: &Path) -> GitProviderRequest {
        GitProviderRequest {
            root: Some(path_to_string(root)),
            project_generation: Some(42),
            ..GitProviderRequest::default()
        }
    }

    fn text_payload_value(payload: &GitTextPayload) -> &str {
        match payload {
            GitTextPayload::String { value, .. } => value,
        }
    }

    #[test]
    fn git_summary_uses_git2_repository_data() {
        let root = test_root("summary");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");

        let summary = git_summary(GitSummaryRequest {
            path: Some(path_to_string(&root)),
        })
        .expect("summary");

        assert!(summary.is_repo);
        assert_eq!(summary.summary.as_deref(), Some("initial commit"));
        assert!(summary.head_hash.as_deref().unwrap_or_default().len() >= 7);
        assert_eq!(summary.head_short.as_deref().unwrap_or_default().len(), 7);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_snapshot_matches_contract_shape() {
        let root = test_root("snapshot");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");
        fs::write(root.join("tracked.txt"), "modified\n").expect("modify tracked");
        fs::write(root.join("new.txt"), "new\n").expect("write untracked");

        let snapshot = git_snapshot(GitSnapshotRequest {
            root: Some(path_to_string(&root)),
            project_generation: Some(42),
            include_status: Some(true),
            include_decorations: Some(true),
            untracked: Some("normal".to_owned()),
        })
        .expect("snapshot");

        assert_eq!(snapshot.dto, "GitSnapshot");
        assert!(snapshot.is_repository);
        assert!(snapshot.has_head);
        assert_eq!(snapshot.project_generation, Some(42));
        assert!(snapshot.unstaged.iter().any(|path| path == "tracked.txt"));
        assert!(snapshot.untracked.iter().any(|path| path == "new.txt"));
        assert_eq!(
            snapshot.statuses.get("tracked.txt").map(String::as_str),
            Some("modified")
        );
        assert_eq!(
            snapshot.statuses.get("new.txt").map(String::as_str),
            Some("untracked")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_snapshot_non_repo_is_successful_empty_dto() {
        let root = test_root("nonrepo");

        let snapshot = git_snapshot(GitSnapshotRequest {
            root: Some(path_to_string(&root)),
            project_generation: Some(3),
            ..GitSnapshotRequest::default()
        })
        .expect("snapshot");

        assert_eq!(snapshot.dto, "GitSnapshot");
        assert!(!snapshot.is_repository);
        assert_eq!(snapshot.project_generation, Some(3));
        assert!(snapshot.statuses.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_head_blob_and_diff_match_contract_shapes() {
        let root = test_root("head-blob-diff");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");
        fs::write(root.join("tracked.txt"), "modified\n").expect("modify tracked");

        let mut blob_request = provider_request(&root);
        blob_request.relative_path = Some("tracked.txt".to_owned());
        let blob = git_head_blob(blob_request).expect("head blob");
        assert_eq!(blob.dto, "GitHeadBlobResult");
        assert!(blob.found);
        assert!(matches!(blob.content, Some(GitTextPayload::String { .. })));

        let mut diff_request = provider_request(&root);
        diff_request.paths = Some(vec!["tracked.txt".to_owned()]);
        let diff = git_diff(diff_request).expect("diff");
        assert_eq!(diff.dto, "GitDiffResult");
        assert_eq!(diff.project_generation, Some(42));
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].relative_path, "tracked.txt");
        assert_eq!(diff.files[0].content_suppressed, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_diff_status_only_suppresses_untracked_and_deleted_bodies() {
        let root = test_root("diff-status-only");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(
            root.join("deleted.txt"),
            "deleted sentinel line\nthat should not be copied\n",
        )
        .expect("write deleted");
        commit_all(&repo, "initial commit");
        fs::remove_file(root.join("deleted.txt")).expect("remove deleted");
        fs::write(
            root.join("new.txt"),
            "untracked sentinel line\nthat should not be copied\n",
        )
        .expect("write untracked");

        let mut diff_request = provider_request(&root);
        diff_request.paths = Some(vec!["deleted.txt".to_owned(), "new.txt".to_owned()]);
        let diff = git_diff(diff_request).expect("diff");
        let deleted_file = diff
            .files
            .iter()
            .find(|file| file.relative_path == "deleted.txt")
            .expect("deleted diff entry");
        assert_eq!(deleted_file.status, "deleted");
        assert_eq!(deleted_file.content_suppressed, Some(true));
        assert_eq!(
            deleted_file.suppressed_reason.as_deref(),
            Some("wholeFileStatusOnly")
        );
        assert_eq!(deleted_file.display_text.as_deref(), Some("Deleted file"));
        assert_eq!(text_payload_value(&deleted_file.patch), "");

        let untracked_file = diff
            .files
            .iter()
            .find(|file| file.relative_path == "new.txt")
            .expect("untracked diff entry");
        assert_eq!(untracked_file.status, "untracked");
        assert_eq!(untracked_file.content_suppressed, Some(true));
        assert_eq!(
            untracked_file.suppressed_reason.as_deref(),
            Some("wholeFileStatusOnly")
        );
        assert_eq!(
            untracked_file.display_text.as_deref(),
            Some("Untracked file")
        );
        assert_eq!(text_payload_value(&untracked_file.patch), "");

        let mut deleted_hunks_request = provider_request(&root);
        deleted_hunks_request.relative_path = Some("deleted.txt".to_owned());
        let deleted_hunks = git_diff_hunks(deleted_hunks_request).expect("deleted hunks");
        assert_eq!(deleted_hunks.relative_path, "deleted.txt");
        assert!(deleted_hunks.hunks.is_empty());
        assert!(deleted_hunks.summary.tracked);
        assert_eq!(deleted_hunks.summary.status.as_deref(), Some("deleted"));
        assert_eq!(deleted_hunks.summary.content_suppressed, Some(true));
        assert_eq!(
            deleted_hunks.summary.suppressed_reason.as_deref(),
            Some("wholeFileStatusOnly")
        );
        assert_eq!(
            deleted_hunks.summary.display_text.as_deref(),
            Some("Deleted file")
        );

        let mut untracked_hunks_request = provider_request(&root);
        untracked_hunks_request.relative_path = Some("new.txt".to_owned());
        let untracked_hunks = git_diff_hunks(untracked_hunks_request).expect("untracked hunks");
        assert_eq!(untracked_hunks.relative_path, "new.txt");
        assert!(untracked_hunks.hunks.is_empty());
        assert!(!untracked_hunks.summary.tracked);
        assert_eq!(untracked_hunks.summary.status.as_deref(), Some("untracked"));
        assert_eq!(untracked_hunks.summary.content_suppressed, Some(true));
        assert_eq!(
            untracked_hunks.summary.suppressed_reason.as_deref(),
            Some("wholeFileStatusOnly")
        );
        assert_eq!(
            untracked_hunks.summary.display_text.as_deref(),
            Some("Untracked file")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_diff_status_only_suppresses_oversized_modified_lines() {
        let root = test_root("diff-oversized-line");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("minified.js"), "const value = 1;\n").expect("write tracked");
        commit_all(&repo, "initial commit");
        let oversized_line = format!(
            "const value = \"{}\";\n",
            "x".repeat(MAX_DIFF_LINE_BYTES + 128)
        );
        fs::write(root.join("minified.js"), oversized_line).expect("write oversized");

        let mut diff_request = provider_request(&root);
        diff_request.paths = Some(vec!["minified.js".to_owned()]);
        let diff = git_diff(diff_request).expect("diff");
        let file = diff
            .files
            .iter()
            .find(|file| file.relative_path == "minified.js")
            .expect("oversized diff entry");
        assert_eq!(file.status, "modified");
        assert_eq!(file.content_suppressed, Some(true));
        assert_eq!(file.suppressed_reason.as_deref(), Some("oversizedDiffLine"));
        assert_eq!(
            file.display_text.as_deref(),
            Some("Diff omitted: contains a line over 8 KB")
        );
        assert_eq!(file.line_byte_limit, Some(MAX_DIFF_LINE_BYTES));
        assert_eq!(text_payload_value(&file.patch), "");

        let mut hunks_request = provider_request(&root);
        hunks_request.relative_path = Some("minified.js".to_owned());
        let hunks = git_diff_hunks(hunks_request).expect("oversized hunks");
        assert_eq!(hunks.relative_path, "minified.js");
        assert!(hunks.hunks.is_empty());
        assert!(hunks.summary.tracked);
        assert_eq!(hunks.summary.status.as_deref(), Some("modified"));
        assert_eq!(hunks.summary.content_suppressed, Some(true));
        assert_eq!(
            hunks.summary.suppressed_reason.as_deref(),
            Some("oversizedDiffLine")
        );
        assert_eq!(hunks.summary.line_byte_limit, Some(MAX_DIFF_LINE_BYTES));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_pull_fast_forward_updates_clean_worktree() {
        let remote_root = test_root("pull-clean-remote");
        let remote_repo = Repository::init(&remote_root).expect("init remote repo");
        fs::write(remote_root.join("tracked.txt"), "base\n").expect("write base");
        commit_all(&remote_repo, "initial commit");
        let branch = current_branch(&remote_repo).expect("remote branch");

        let local_root = test_root("pull-clean-local");
        let _local_repo = RepoBuilder::new()
            .clone(&path_to_string(&remote_root), &local_root)
            .expect("clone local");

        fs::write(remote_root.join("tracked.txt"), "remote\n").expect("write remote");
        commit_all(&remote_repo, "remote update");

        let mut request = provider_request(&local_root);
        request.branch = Some(branch);
        let result = git_pull(request).expect("pull");

        assert_eq!(result.dto, "GitMutationResult");
        assert_eq!(result.operation, "pull");
        assert_eq!(
            fs::read_to_string(local_root.join("tracked.txt")).unwrap(),
            "remote\n"
        );

        let _ = fs::remove_dir_all(remote_root);
        let _ = fs::remove_dir_all(local_root);
    }

    #[test]
    fn git_pull_rejects_fast_forward_that_would_overwrite_local_tracked_changes() {
        let remote_root = test_root("pull-dirty-remote");
        let remote_repo = Repository::init(&remote_root).expect("init remote repo");
        fs::write(remote_root.join("tracked.txt"), "base\n").expect("write base");
        commit_all(&remote_repo, "initial commit");
        let branch = current_branch(&remote_repo).expect("remote branch");

        let local_root = test_root("pull-dirty-local");
        let local_repo = RepoBuilder::new()
            .clone(&path_to_string(&remote_root), &local_root)
            .expect("clone local");
        let head_before = local_repo.head().unwrap().target().unwrap();

        fs::write(remote_root.join("tracked.txt"), "remote\n").expect("write remote");
        commit_all(&remote_repo, "remote update");
        fs::write(local_root.join("tracked.txt"), "local\n").expect("write local change");

        let mut request = provider_request(&local_root);
        request.branch = Some(branch);
        let result = git_pull(request);

        match result {
            Err(GitProviderError::LocalChangesWouldBeOverwritten(paths)) => {
                assert_eq!(paths, vec!["tracked.txt".to_owned()]);
            }
            other => panic!("expected local-change protection, got {other:?}"),
        }
        let reopened = Repository::open(&local_root).expect("reopen local");
        assert_eq!(reopened.head().unwrap().target().unwrap(), head_before);
        assert_eq!(
            fs::read_to_string(local_root.join("tracked.txt")).unwrap(),
            "local\n"
        );

        let _ = fs::remove_dir_all(remote_root);
        let _ = fs::remove_dir_all(local_root);
    }

    #[test]
    fn git_pull_fast_forward_preserves_unrelated_local_tracked_changes() {
        let remote_root = test_root("pull-unrelated-remote");
        let remote_repo = Repository::init(&remote_root).expect("init remote repo");
        fs::write(remote_root.join("pulled.txt"), "base\n").expect("write pulled base");
        fs::write(remote_root.join("local.txt"), "base\n").expect("write local base");
        commit_all(&remote_repo, "initial commit");
        let branch = current_branch(&remote_repo).expect("remote branch");

        let local_root = test_root("pull-unrelated-local");
        let _local_repo = RepoBuilder::new()
            .clone(&path_to_string(&remote_root), &local_root)
            .expect("clone local");

        fs::write(remote_root.join("pulled.txt"), "remote\n").expect("write remote update");
        commit_all(&remote_repo, "remote update");
        fs::write(local_root.join("local.txt"), "local\n").expect("write unrelated local change");

        let mut request = provider_request(&local_root);
        request.branch = Some(branch);
        let result = git_pull(request).expect("pull");

        assert_eq!(result.operation, "pull");
        assert_eq!(
            fs::read_to_string(local_root.join("pulled.txt")).unwrap(),
            "remote\n"
        );
        assert_eq!(
            fs::read_to_string(local_root.join("local.txt")).unwrap(),
            "local\n"
        );

        let _ = fs::remove_dir_all(remote_root);
        let _ = fs::remove_dir_all(local_root);
    }

    #[test]
    fn git_missing_service_dtos_match_contract_shapes() {
        let root = test_root("missing-dtos");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        fs::write(root.join("stable.txt"), "stable\n").expect("write stable");
        commit_all(&repo, "initial commit");
        fs::write(root.join("tracked.txt"), "tracked\nmodified\n").expect("modify tracked");
        fs::write(root.join("new.txt"), "new\n").expect("write new");

        let mut hunks_request = provider_request(&root);
        hunks_request.relative_path = Some("tracked.txt".to_owned());
        let hunks = git_diff_hunks(hunks_request).expect("diff hunks");
        assert_eq!(hunks.dto, "GitDiffHunks");
        assert_eq!(hunks.relative_path, "tracked.txt");
        assert_eq!(hunks.project_generation, Some(42));
        assert!(hunks.summary.tracked);
        assert_eq!(hunks.summary.status.as_deref(), Some("modified"));
        assert_eq!(hunks.summary.content_suppressed, None);
        assert!(hunks.summary.added >= 1);
        assert!(!hunks.hunks.is_empty());

        let changes = git_worktree_changes(provider_request(&root)).expect("worktree changes");
        assert_eq!(changes.dto, "GitWorktreeChanges");
        assert!(changes.is_repository);
        assert!(
            changes
                .changes
                .iter()
                .any(|change| change.path == "tracked.txt" && change.code == "M")
        );
        assert!(
            changes
                .changes
                .iter()
                .any(|change| change.path == "new.txt" && change.code == "??")
        );

        let path_index = git_path_index(provider_request(&root)).expect("path index");
        assert_eq!(path_index.dto, "GitPathIndex");
        assert!(path_index.is_repository);
        assert!(path_index.paths.iter().any(|path| path == "tracked.txt"));
        assert!(path_index.paths.iter().any(|path| path == "stable.txt"));
        assert!(path_index.paths.iter().any(|path| path == "new.txt"));

        let commit_info = git_commit_info(provider_request(&root)).expect("commit info");
        assert_eq!(commit_info.dto, "GitCommitInfoResult");
        assert!(commit_info.found);
        let commit = commit_info.commit.expect("commit");
        assert_eq!(commit.summary.as_deref(), Some("initial commit"));
        assert_eq!(commit.short_hash.len(), 7);

        let reset = git_reset_hard(provider_request(&root)).expect("reset hard");
        assert_eq!(reset.dto, "GitMutationResult");
        assert_eq!(reset.operation, "resetHard");
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).unwrap(),
            "tracked\n"
        );

        let non_repo = test_root("missing-dtos-nonrepo");
        let non_repo_changes =
            git_worktree_changes(provider_request(&non_repo)).expect("nonrepo changes");
        assert_eq!(non_repo_changes.dto, "GitWorktreeChanges");
        assert!(!non_repo_changes.is_repository);
        let non_repo_index = git_path_index(provider_request(&non_repo)).expect("nonrepo index");
        assert_eq!(non_repo_index.dto, "GitPathIndex");
        assert!(!non_repo_index.is_repository);

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(non_repo);
    }

    #[test]
    fn git_mutation_branch_remote_and_history_shapes() {
        let root = test_root("mutation");
        let repo = Repository::init(&root).expect("init repo");
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        commit_all(&repo, "initial commit");
        fs::write(root.join("new.txt"), "new\n").expect("write new");

        let mut stage_request = provider_request(&root);
        stage_request.paths = Some(vec!["new.txt".to_owned()]);
        let stage = git_stage(stage_request).expect("stage");
        assert_eq!(stage.dto, "GitMutationResult");
        assert_eq!(stage.changed_paths, vec!["new.txt"]);

        let mut commit_request = provider_request(&root);
        commit_request.message = Some("add new".to_owned());
        let commit = git_commit(commit_request).expect("commit");
        assert_eq!(commit.operation, "commit");

        let mut branch_request = provider_request(&root);
        branch_request.name = Some("feature/test".to_owned());
        let branch_create = git_branch_create(branch_request).expect("branch create");
        assert_eq!(branch_create.operation, "branchCreate");

        let branches = git_branch_list(provider_request(&root)).expect("branches");
        assert_eq!(branches.dto, "GitBranchList");
        assert!(
            branches
                .branches
                .iter()
                .any(|branch| branch.name == "feature/test")
        );

        let mut remote_request = provider_request(&root);
        remote_request.name = Some("origin".to_owned());
        remote_request.fetch_url = Some("https://example.invalid/repo.git".to_owned());
        let remote_add = git_remote_add(remote_request).expect("remote add");
        assert_eq!(remote_add.operation, "remoteAdd");

        let remotes = git_remote_list(provider_request(&root)).expect("remotes");
        assert_eq!(remotes.dto, "GitRemoteList");
        assert_eq!(remotes.remotes[0].name, "origin");

        let history = git_history(provider_request(&root)).expect("history");
        assert_eq!(history.dto, "GitHistoryResult");
        assert!(!history.commits.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
