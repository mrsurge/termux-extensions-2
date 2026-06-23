use super::common::{expand_user_path, home_dir, normalize_lexical};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};

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

    fn error(is_repo: bool, error: String) -> Self {
        Self {
            is_repo,
            branch: None,
            head_hash: None,
            head_short: None,
            summary: None,
            error: Some(error),
        }
    }
}

#[derive(Debug)]
pub(crate) enum GitSummaryError {
    MissingPath,
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

fn git_summary_for_path(raw_path: &str) -> GitSummaryData {
    let mut target_path = normalize_lexical(expand_user_path(raw_path.trim(), &home_dir()));
    if !target_path.exists() {
        return GitSummaryData::not_repo();
    }
    if target_path.is_file() {
        if let Some(parent) = target_path.parent() {
            target_path = parent.to_path_buf();
        }
    }
    target_path = fs::canonicalize(&target_path).unwrap_or(target_path);

    match is_git_repository(&target_path) {
        Ok(true) => {}
        Ok(false) => return GitSummaryData::not_repo(),
        Err(error) => return GitSummaryData::error(false, error),
    }

    match git_summary_for_repo(&target_path) {
        Ok(summary) => summary,
        Err(error) => GitSummaryData::error(true, error),
    }
}

fn is_git_repository(project_root: &Path) -> Result<bool, String> {
    let Some(output) = run_git_optional(project_root, &["rev-parse", "--is-inside-work-tree"])?
    else {
        return Ok(false);
    };
    Ok(output.trim() == "true")
}

fn git_summary_for_repo(project_root: &Path) -> Result<GitSummaryData, String> {
    let branch = run_git_optional(project_root, &["symbolic-ref", "--short", "HEAD"])?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "DETACHED".to_owned());
    let commit = run_git_optional(
        project_root,
        &["log", "-1", "--format=%H|%h|%s|%an|%ai", "HEAD"],
    )?
    .and_then(parse_commit_info);

    let (head_hash, head_short, summary) = commit
        .map(|parts| (Some(parts.0), Some(parts.1), Some(parts.2)))
        .unwrap_or((None, None, None));
    Ok(GitSummaryData {
        is_repo: true,
        branch: Some(branch),
        head_hash,
        head_short,
        summary,
        error: None,
    })
}

fn parse_commit_info(raw: String) -> Option<(String, String, String)> {
    let parts = raw.splitn(5, '|').collect::<Vec<_>>();
    if parts.len() != 5 {
        return None;
    }
    Some((
        parts[0].to_owned(),
        parts[1].to_owned(),
        parts[2].to_owned(),
    ))
}

fn run_git_optional(project_root: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let output = match Command::new("git")
        .arg("-C")
        .arg(project_root)
        .args(args)
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_owned(),
    ))
}
