use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::{DirEntry, WalkBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use super::common::{expand_user_path, home_dir, normalize_lexical, path_to_string};

#[path = "search_parallel.rs"]
mod search_parallel;

// Ripgrep library stack only: filesystem walking, glob filters, and content
// matching stay in-process and must never shell out to the `rg` command.
const DEFAULT_MAX_RESULTS: usize = 500;
const PROVIDER_MAX_RESULTS: usize = 10_000;
const DEFAULT_CONTEXT_CHARS: usize = 75;
const PROVIDER_MAX_CONTEXT_CHARS: usize = 500;
const SEARCH_DTO_VERSION: u16 = 1;

// Provider DTOs originate at this service boundary so pipe/net adapters do not
// invent transport-specific search schemas.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchFilesRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) query: String,
    pub(crate) max_results: Option<usize>,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) include_hidden: bool,
    #[serde(
        default = "default_true",
        deserialize_with = "super::common::deserialize_boolish"
    )]
    pub(crate) use_ignore_files: bool,
    #[serde(default)]
    pub(crate) include_patterns: Vec<String>,
    #[serde(default)]
    pub(crate) exclude_patterns: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchFilesStartRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) correlation_id: Option<String>,
    pub(crate) query: String,
    pub(crate) max_results: Option<usize>,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) include_hidden: bool,
    #[serde(
        default = "default_true",
        deserialize_with = "super::common::deserialize_boolish"
    )]
    pub(crate) use_ignore_files: bool,
    #[serde(default)]
    pub(crate) include_patterns: Vec<String>,
    #[serde(default)]
    pub(crate) exclude_patterns: Vec<String>,
}

impl SearchFilesStartRequest {
    pub(crate) fn into_provider_request(self) -> SearchFilesRequest {
        SearchFilesRequest {
            dto: None,
            version: None,
            root: self.root,
            project_generation: self.project_generation,
            query: self.query,
            max_results: self.max_results,
            include_hidden: self.include_hidden,
            use_ignore_files: self.use_ignore_files,
            include_patterns: self.include_patterns,
            exclude_patterns: self.exclude_patterns,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchFilesResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    pub(crate) query: String,
    pub(crate) items: Vec<SearchFileItem>,
    pub(crate) count: usize,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchFileItem {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) kind: SearchFileKind,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SearchFileKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchContentRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) query: String,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_regex: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_case_sensitive: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_whole_words: bool,
    #[serde(default)]
    pub(crate) include_patterns: Vec<String>,
    #[serde(default)]
    pub(crate) exclude_patterns: Vec<String>,
    #[serde(
        default = "default_true",
        deserialize_with = "super::common::deserialize_boolish"
    )]
    pub(crate) use_ignore_files: bool,
    pub(crate) max_files: Option<usize>,
    pub(crate) max_matches_per_file: Option<usize>,
    pub(crate) max_matches_total: Option<usize>,
    pub(crate) max_file_size_bytes: Option<u64>,
    pub(crate) context_chars: Option<usize>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchContentStartRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) correlation_id: Option<String>,
    pub(crate) query: String,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_regex: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_case_sensitive: bool,
    #[serde(default, deserialize_with = "super::common::deserialize_boolish")]
    pub(crate) is_whole_words: bool,
    #[serde(default)]
    pub(crate) include_patterns: Vec<String>,
    #[serde(default)]
    pub(crate) exclude_patterns: Vec<String>,
    #[serde(
        default = "default_true",
        deserialize_with = "super::common::deserialize_boolish"
    )]
    pub(crate) use_ignore_files: bool,
    pub(crate) max_files: Option<usize>,
    pub(crate) max_matches_per_file: Option<usize>,
    pub(crate) max_matches_total: Option<usize>,
    pub(crate) max_file_size_bytes: Option<u64>,
    pub(crate) context_chars: Option<usize>,
    pub(crate) presentation_window: Option<SearchPresentationWindow>,
}

impl SearchContentStartRequest {
    pub(crate) fn into_provider_request(self) -> SearchContentRequest {
        SearchContentRequest {
            dto: None,
            version: None,
            root: self.root,
            project_generation: self.project_generation,
            query: self.query,
            is_regex: self.is_regex,
            is_case_sensitive: self.is_case_sensitive,
            is_whole_words: self.is_whole_words,
            include_patterns: self.include_patterns,
            exclude_patterns: self.exclude_patterns,
            use_ignore_files: self.use_ignore_files,
            max_files: self.max_files,
            max_matches_per_file: self.max_matches_per_file,
            max_matches_total: self.max_matches_total,
            max_file_size_bytes: self.max_file_size_bytes,
            context_chars: self.context_chars,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPresentationWindow {
    pub(crate) max_visible_files: Option<usize>,
    pub(crate) max_visible_matches_per_file: Option<usize>,
    pub(crate) max_visible_matches_total: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchContentResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    pub(crate) query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) search_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_file_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_match_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_global_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) truncated_reason: Option<String>,
    pub(crate) files: Vec<SearchContentFile>,
    pub(crate) file_count: usize,
    pub(crate) match_count: usize,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchContentFile {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) file_match_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matches_returned: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) file_truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_match_cursor: Option<String>,
    pub(crate) matches: Vec<SearchContentMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchContentMatch {
    pub(crate) line_number: u64,
    pub(crate) column_number: usize,
    pub(crate) line_text: String,
    pub(crate) snippet: String,
    pub(crate) match_text: String,
    pub(crate) line_ranges: Vec<SearchTextRange>,
    pub(crate) snippet_ranges: Vec<SearchTextRange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchTextRange {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SearchProgressCounts {
    pub(crate) files_scanned: usize,
    pub(crate) files_matched: usize,
    pub(crate) matches_found: usize,
}

#[derive(Clone)]
pub(crate) struct SearchRunOptions {
    pub(crate) search_id: Option<String>,
    pub(crate) job_id: Option<String>,
    pub(crate) cancelled: Option<Arc<AtomicBool>>,
    pub(crate) progress: Option<Arc<dyn Fn(SearchProgressCounts) -> bool + Send + Sync>>,
    pub(crate) content_result: Option<Arc<dyn Fn(SearchContentResult) -> bool + Send + Sync>>,
}

impl Default for SearchRunOptions {
    fn default() -> Self {
        Self {
            search_id: None,
            job_id: None,
            cancelled: None,
            progress: None,
            content_result: None,
        }
    }
}

impl SearchRunOptions {
    fn is_cancelled(&self) -> bool {
        self.cancelled
            .as_ref()
            .is_some_and(|cancelled| cancelled.load(Ordering::Relaxed))
    }

    fn check_cancelled(&self) -> Result<(), SearchProviderError> {
        if self.is_cancelled() {
            Err(SearchProviderError::Cancelled)
        } else {
            Ok(())
        }
    }

    fn emit_progress(&self, counts: SearchProgressCounts) -> Result<(), SearchProviderError> {
        self.check_cancelled()?;
        if let Some(progress) = &self.progress {
            if !progress(counts) {
                return Err(SearchProviderError::Cancelled);
            }
        }
        self.check_cancelled()
    }

    fn has_content_result_sink(&self) -> bool {
        self.content_result.is_some()
    }

    fn emit_content_result(&self, result: SearchContentResult) -> Result<(), SearchProviderError> {
        self.check_cancelled()?;
        if let Some(content_result) = &self.content_result {
            if !content_result(result) {
                return Err(SearchProviderError::Cancelled);
            }
        }
        self.check_cancelled()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobStarted {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) kind: &'static str,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobProgress {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) kind: &'static str,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    pub(crate) status: String,
    pub(crate) message: String,
    pub(crate) files_scanned: usize,
    pub(crate) files_matched: usize,
    pub(crate) matches_found: usize,
    pub(crate) sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) kind: &'static str,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    pub(crate) result: Value,
    pub(crate) sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobDone {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) kind: &'static str,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) files_scanned: usize,
    pub(crate) files_matched: usize,
    pub(crate) matches_found: usize,
    pub(crate) cancelled: bool,
    pub(crate) sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobError {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) kind: &'static str,
    pub(crate) root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) sequence: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobCancelRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) job_id: Option<String>,
    pub(crate) search_id: Option<String>,
    pub(crate) op_id: Option<String>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchJobCancelResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) job_id: String,
    pub(crate) search_id: String,
    pub(crate) op_id: String,
    pub(crate) ok: bool,
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

#[derive(Debug)]
pub(crate) enum SearchProviderError {
    MissingRoot,
    InvalidRoot(String),
    InvalidPattern(String),
    InvalidRegex(String),
    InvalidRequest(String),
    Cancelled,
    Io(String),
    Search(String),
}

impl From<io::Error> for SearchProviderError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

pub(crate) fn validate_contract_metadata(
    dto: Option<&str>,
    version: Option<u16>,
    expected_dto: &str,
) -> Result<(), SearchProviderError> {
    if let Some(dto) = dto {
        if dto != expected_dto {
            return Err(SearchProviderError::InvalidRequest(format!(
                "expected dto {expected_dto}, got {dto}"
            )));
        }
    }
    if let Some(version) = version {
        if version != SEARCH_DTO_VERSION {
            return Err(SearchProviderError::InvalidRequest(format!(
                "unsupported {expected_dto} version {version}"
            )));
        }
    }
    Ok(())
}

pub(crate) fn resolved_root_string(root: Option<&str>) -> Result<String, SearchProviderError> {
    resolve_root(root).map(|root| path_to_string(&root))
}

pub(crate) fn search_files(
    request: SearchFilesRequest,
) -> Result<SearchFilesResult, SearchProviderError> {
    search_files_with_options(request, SearchRunOptions::default())
}

pub(crate) fn search_files_with_options(
    request: SearchFilesRequest,
    options: SearchRunOptions,
) -> Result<SearchFilesResult, SearchProviderError> {
    // Initial search methods are synchronous request/response DTO producers;
    // progressive job methods layer on top of these item/match shapes.
    let root = resolve_root(request.root.as_deref())?;
    let query = request.query.trim().to_owned();
    let max_results = cap_usize(
        request.max_results,
        DEFAULT_MAX_RESULTS,
        PROVIDER_MAX_RESULTS,
    );
    let include = build_glob_set(&request.include_patterns)?;
    let exclude = build_glob_set(&request.exclude_patterns)?;
    let mut items = Vec::new();
    let mut truncated = max_results == 0;
    let mut counts = SearchProgressCounts::default();

    // File-name search uses the same ignore walker family as ripgrep; DTO
    // packing stays local so transports do not leak walker/searcher details.
    for entry in build_walk(&root, request.include_hidden, request.use_ignore_files) {
        options.check_cancelled()?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path == root {
            continue;
        }
        counts.files_scanned += 1;
        let Some(relative_path) = relative_posix(&root, path) else {
            continue;
        };
        let name = entry_name(&entry);
        if !path_allowed(&relative_path, &name, &include, &exclude) {
            continue;
        }
        if !name_matches(&name, &query) {
            continue;
        }
        if items.len() >= max_results {
            truncated = true;
            break;
        }
        let kind = if entry_is_dir(&entry) {
            SearchFileKind::Dir
        } else {
            SearchFileKind::File
        };
        items.push(SearchFileItem {
            path: path_to_string(path),
            relative_path,
            kind,
            name,
        });
        counts.files_matched = items.len();
        counts.matches_found = items.len();
        options.emit_progress(counts)?;
    }

    Ok(SearchFilesResult {
        dto: "SearchFilesResult",
        version: SEARCH_DTO_VERSION,
        root: path_to_string(&root),
        project_generation: request.project_generation,
        query: request.query,
        count: items.len(),
        items,
        truncated,
    })
}

pub(crate) fn search_content(
    request: SearchContentRequest,
) -> Result<SearchContentResult, SearchProviderError> {
    search_content_with_options(request, SearchRunOptions::default())
}

pub(crate) fn search_content_with_options(
    request: SearchContentRequest,
    options: SearchRunOptions,
) -> Result<SearchContentResult, SearchProviderError> {
    if options.has_content_result_sink()
        && request.max_files.is_none()
        && request.max_matches_total.is_none()
    {
        return search_parallel::search_content_parallel_with_options(request, options);
    }

    let root = resolve_root(request.root.as_deref())?;
    let matcher = build_content_matcher(&request)?;
    let include = build_glob_set(&request.include_patterns)?;
    let exclude = build_glob_set(&request.exclude_patterns)?;
    let context_chars = cap_usize(
        request.context_chars,
        DEFAULT_CONTEXT_CHARS,
        PROVIDER_MAX_CONTEXT_CHARS,
    );
    let mut files = Vec::new();
    let mut match_count = 0usize;
    let mut counts = SearchProgressCounts::default();
    let mut truncated_reason: Option<String> = None;
    let stream_content_results = options.has_content_result_sink();

    // Content search delegates matching to ripgrep's matcher/searcher crates.
    // Only caller-provided caps may truncate results; absent caps mean complete scan.
    for entry in build_walk(&root, false, request.use_ignore_files) {
        options.check_cancelled()?;
        if explicit_cap_reached(files.len(), request.max_files) {
            set_truncation_reason(&mut truncated_reason, "maxFiles");
            break;
        }
        if explicit_cap_reached(match_count, request.max_matches_total) {
            set_truncation_reason(&mut truncated_reason, "maxMatchesTotal");
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry_is_file(&entry) {
            continue;
        }
        let path = entry.path();
        let Some(relative_path) = relative_posix(&root, path) else {
            continue;
        };
        let name = entry_name(&entry);
        if !path_allowed(&relative_path, &name, &include, &exclude) {
            continue;
        }
        counts.files_scanned += 1;
        if request
            .max_file_size_bytes
            .is_some_and(|max_bytes| is_too_large(path, max_bytes))
        {
            set_truncation_reason(&mut truncated_reason, "maxFileSizeBytes");
            options.emit_progress(counts)?;
            continue;
        }

        let remaining_total = request
            .max_matches_total
            .map(|max_matches| max_matches.saturating_sub(match_count));
        let effective_match_cap = min_optional(request.max_matches_per_file, remaining_total);
        if explicit_cap_reached(0, effective_match_cap) {
            set_truncation_reason(
                &mut truncated_reason,
                match_cap_reason(request.max_matches_per_file, remaining_total),
            );
            break;
        }

        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .build();
        let mut sink = ContentSink {
            matcher: &matcher,
            max_matches_per_file: effective_match_cap,
            context_chars,
            matches: Vec::new(),
            cap_reached: false,
        };
        match searcher.search_path(&matcher, path, &mut sink) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted && sink.cap_reached => {
                set_truncation_reason(
                    &mut truncated_reason,
                    match_cap_reason(request.max_matches_per_file, remaining_total),
                );
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                set_truncation_reason(&mut truncated_reason, "interrupted");
            }
            Err(error) => return Err(SearchProviderError::Search(error.to_string())),
        }
        if sink.matches.is_empty() {
            options.emit_progress(counts)?;
            continue;
        }
        let matches_returned = sink.matches.len();
        match_count += matches_returned;
        counts.files_matched += 1;
        counts.matches_found = match_count;
        let file_truncated = sink.cap_reached;
        let file_result = SearchContentFile {
            path: path_to_string(path),
            relative_path,
            file_match_count: Some(matches_returned),
            matches_returned: Some(matches_returned),
            file_truncated: Some(file_truncated),
            next_match_cursor: file_truncated.then(|| matches_returned.to_string()),
            matches: sink.matches,
        };
        if stream_content_results {
            options.emit_content_result(SearchContentResult {
                dto: "SearchContentResult",
                version: SEARCH_DTO_VERSION,
                root: path_to_string(&root),
                project_generation: request.project_generation,
                query: request.query.clone(),
                search_id: options.search_id.clone(),
                job_id: options.job_id.clone(),
                complete: Some(false),
                total_file_count: Some(counts.files_matched),
                total_match_count: Some(match_count),
                next_global_cursor: None,
                truncated_reason: None,
                file_count: 1,
                match_count: matches_returned,
                files: vec![file_result],
                truncated: false,
            })?;
        } else {
            files.push(file_result);
        }
        options.emit_progress(counts)?;
    }

    let truncated = truncated_reason.is_some();
    let result_file_count = if stream_content_results {
        counts.files_matched
    } else {
        files.len()
    };
    Ok(SearchContentResult {
        dto: "SearchContentResult",
        version: SEARCH_DTO_VERSION,
        root: path_to_string(&root),
        project_generation: request.project_generation,
        query: request.query,
        search_id: options.search_id,
        job_id: options.job_id,
        complete: Some(!truncated),
        total_file_count: Some(result_file_count),
        total_match_count: Some(match_count),
        next_global_cursor: truncated.then(|| result_file_count.to_string()),
        truncated_reason,
        file_count: files.len(),
        match_count,
        files,
        truncated,
    })
}

struct ContentSink<'a> {
    matcher: &'a grep_regex::RegexMatcher,
    max_matches_per_file: Option<usize>,
    context_chars: usize,
    matches: Vec<SearchContentMatch>,
    cap_reached: bool,
}

impl Sink for ContentSink<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self
            .max_matches_per_file
            .is_some_and(|max_matches| self.matches.len() >= max_matches)
        {
            self.cap_reached = true;
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "search cap reached",
            ));
        }
        let line_bytes = strip_line_ending(mat.bytes());
        let Some(found) = self
            .matcher
            .find(line_bytes)
            .map_err(|error| io::Error::other(error.to_string()))?
        else {
            return Ok(true);
        };
        let line_text = String::from_utf8_lossy(line_bytes).into_owned();
        let match_text = String::from_utf8_lossy(&line_bytes[found]).into_owned();
        self.matches.push(content_match_dto(
            mat.line_number().unwrap_or(0),
            &line_text,
            found.start(),
            found.end(),
            match_text,
            self.context_chars,
        ));
        if self
            .max_matches_per_file
            .is_some_and(|max_matches| self.matches.len() >= max_matches)
        {
            self.cap_reached = true;
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "search cap reached",
            ));
        }
        Ok(true)
    }
}

fn build_content_matcher(
    request: &SearchContentRequest,
) -> Result<grep_regex::RegexMatcher, SearchProviderError> {
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(!request.is_case_sensitive)
        .fixed_strings(!request.is_regex)
        .word(request.is_whole_words)
        .line_terminator(Some(b'\n'));
    builder
        .build(&request.query)
        .map_err(|error| SearchProviderError::InvalidRegex(error.to_string()))
}

fn content_match_dto(
    line_number: u64,
    line_text: &str,
    match_start: usize,
    match_end: usize,
    match_text: String,
    context_chars: usize,
) -> SearchContentMatch {
    let line_len = line_text.len();
    let start = match_start.saturating_sub(context_chars);
    let end = (match_end + context_chars).min(line_len);
    let snippet = line_text.get(start..end).unwrap_or(line_text).to_owned();
    let snippet_match_start = match_start.saturating_sub(start);
    let snippet_match_end = snippet_match_start + match_end.saturating_sub(match_start);
    SearchContentMatch {
        line_number,
        column_number: match_start + 1,
        line_text: line_text.to_owned(),
        snippet,
        match_text,
        line_ranges: vec![SearchTextRange {
            start: match_start,
            end: match_end,
        }],
        snippet_ranges: vec![SearchTextRange {
            start: snippet_match_start,
            end: snippet_match_end,
        }],
    }
}

fn resolve_root(root: Option<&str>) -> Result<PathBuf, SearchProviderError> {
    let root = root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SearchProviderError::MissingRoot)?;
    let expanded = expand_user_path(root, &home_dir());
    let normalized = normalize_lexical(expanded);
    let canonical = fs::canonicalize(&normalized)
        .map_err(|error| SearchProviderError::InvalidRoot(error.to_string()))?;
    if !canonical.is_dir() {
        return Err(SearchProviderError::InvalidRoot(format!(
            "search root is not a directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn build_walk(root: &Path, include_hidden: bool, use_ignore_files: bool) -> ignore::Walk {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(!include_hidden)
        .parents(use_ignore_files)
        .ignore(use_ignore_files)
        .git_ignore(use_ignore_files)
        .git_global(use_ignore_files)
        .git_exclude(use_ignore_files)
        .follow_links(false);
    builder.build()
}

fn build_glob_set(patterns: &[String]) -> Result<Option<GlobSet>, SearchProviderError> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for raw in patterns {
        let pattern = raw.trim();
        if pattern.is_empty() {
            continue;
        }
        let glob = GlobBuilder::new(pattern)
            .literal_separator(false)
            .build()
            .map_err(|error| SearchProviderError::InvalidPattern(error.to_string()))?;
        builder.add(glob);
    }
    builder
        .build()
        .map(Some)
        .map_err(|error| SearchProviderError::InvalidPattern(error.to_string()))
}

fn path_allowed(
    relative_path: &str,
    name: &str,
    include: &Option<GlobSet>,
    exclude: &Option<GlobSet>,
) -> bool {
    if let Some(include) = include {
        if !include.is_match(relative_path) && !include.is_match(name) {
            return false;
        }
    }
    if let Some(exclude) = exclude {
        if exclude.is_match(relative_path) || exclude.is_match(name) {
            return false;
        }
    }
    true
}

fn name_matches(name: &str, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    name.to_ascii_lowercase()
        .contains(&query.to_ascii_lowercase())
}

fn entry_name(entry: &DirEntry) -> String {
    entry.file_name().to_string_lossy().into_owned()
}

fn entry_is_file(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .map(|kind| kind.is_file())
        .unwrap_or_else(|| entry.path().is_file())
}

fn entry_is_dir(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .map(|kind| kind.is_dir())
        .unwrap_or_else(|| entry.path().is_dir())
}

fn relative_posix(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn is_too_large(path: &Path, max_file_size_bytes: u64) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.len() > max_file_size_bytes)
        .unwrap_or(true)
}

fn strip_line_ending(bytes: &[u8]) -> &[u8] {
    bytes
        .strip_suffix(b"\r\n")
        .or_else(|| bytes.strip_suffix(b"\n"))
        .unwrap_or(bytes)
}

fn cap_usize(value: Option<usize>, default: usize, provider_cap: usize) -> usize {
    value.unwrap_or(default).min(provider_cap)
}

fn min_optional(left: Option<usize>, right: Option<usize>) -> Option<usize> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn explicit_cap_reached(current: usize, cap: Option<usize>) -> bool {
    cap.is_some_and(|cap| current >= cap)
}

fn set_truncation_reason(reason: &mut Option<String>, value: &str) {
    if reason.is_none() {
        *reason = Some(value.to_owned());
    }
}

fn match_cap_reason(per_file: Option<usize>, remaining_total: Option<usize>) -> &'static str {
    match (per_file, remaining_total) {
        (Some(per_file), Some(remaining_total)) if per_file <= remaining_total => {
            "maxMatchesPerFile"
        }
        (Some(_), None) => "maxMatchesPerFile",
        (_, Some(_)) => "maxMatchesTotal",
        _ => "maxMatchesPerFile",
    }
}

fn default_true() -> bool {
    true
}
