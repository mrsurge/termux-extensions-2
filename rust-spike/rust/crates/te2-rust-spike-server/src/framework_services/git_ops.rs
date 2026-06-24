use super::common::{expand_user_path, home_dir, normalize_lexical, path_to_string};
use git2::{
    BranchType, Delta, Diff, DiffFormat, DiffOptions, ErrorCode, IndexAddOption, Oid, Repository,
    Signature, Status, StatusOptions, StatusShow, build::CheckoutBuilder,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
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
        let patch = diff_patch_text(&file_diff)?;
        if patch.is_empty() {
            continue;
        }
        files.push(GitDiffFile {
            relative_path: relative_path.clone(),
            status: diff_status_for_path(&file_diff, relative_path),
            patch: GitTextPayload::utf8(patch),
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
    let url = required_text(request.url.as_deref(), GitProviderError::MissingUrl)?;
    let destination = request
        .destination
        .as_deref()
        .or(request.path.as_deref())
        .or(request.root.as_deref())
        .filter(|value| !value.trim().is_empty())
        .ok_or(GitProviderError::MissingDestination)?;
    let destination = normalize_existing_path(destination);
    let repo = Repository::clone(url, &destination)?;
    Ok(mutation_result(&repo, &destination, "clone", Vec::new()))
}

pub(crate) fn git_pull(request: GitProviderRequest) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let remote_name = request.remote.as_deref().unwrap_or("origin");
    let branch = request
        .branch
        .clone()
        .or_else(|| current_branch(&repo))
        .ok_or(GitProviderError::NoHead)?;
    let mut remote = repo.find_remote(remote_name)?;
    remote.fetch(&[branch.as_str()], None, None)?;
    let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
    let remote_oid = repo.refname_to_id(&remote_ref)?;
    let annotated = repo.find_annotated_commit(remote_oid)?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;
    if analysis.is_up_to_date() {
        return Ok(mutation_result(&repo, &root, "pull", Vec::new()));
    }
    if !analysis.is_fast_forward() {
        return Err(GitProviderError::Unsupported(
            "non-fast-forward pull is not implemented in the Rust spike provider".to_owned(),
        ));
    }
    fast_forward(&repo, &branch, remote_oid)?;
    Ok(mutation_result(&repo, &root, "pull", Vec::new()))
}

pub(crate) fn git_push(request: GitProviderRequest) -> Result<GitMutationResult, GitProviderError> {
    let (repo, root) = repo_from_request(&request)?;
    let remote_name = request.remote.as_deref().unwrap_or("origin");
    let branch = request
        .branch
        .clone()
        .or_else(|| current_branch(&repo))
        .ok_or(GitProviderError::NoHead)?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let mut remote = repo.find_remote(remote_name)?;
    remote.push(&[refspec.as_str()], None)?;
    Ok(mutation_result(&repo, &root, "push", Vec::new()))
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
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("te2-rust-spike-git-{name}-{}", std::process::id()));
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

        let _ = fs::remove_dir_all(root);
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
