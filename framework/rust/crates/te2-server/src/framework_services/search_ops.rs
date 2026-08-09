use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::{DirEntry, WalkBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
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
const MIN_SEARCH_THREADS: usize = 1;
const MAX_SEARCH_THREADS: usize = 64;
const RUST_SEARCH_THREADS_ENV: &str = "TE2_RUST_SEARCH_THREADS";

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
    pub(crate) presentation_window: Option<SearchPresentationWindow>,
    pub(crate) search_threads: Option<usize>,
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
    pub(crate) search_threads: Option<usize>,
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
            presentation_window: self.presentation_window,
            search_threads: self.search_threads,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPresentationWindow {
    #[serde(alias = "maxInitialFiles")]
    pub(crate) max_visible_files: Option<usize>,
    #[serde(alias = "maxInitialMatchesPerFile")]
    pub(crate) max_visible_matches_per_file: Option<usize>,
    #[serde(alias = "maxInitialMatchesTotal")]
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
    pub(crate) files_scanned: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_global_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) truncated_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) match_limit: Option<usize>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cancellation_reason: Option<String>,
    pub(crate) truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) truncated_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) match_limit: Option<usize>,
    pub(crate) optional_events_dropped: u64,
    pub(crate) required_event_backpressure_count: u64,
    pub(crate) required_event_backpressure_ms: u64,
    pub(crate) required_event_failures: u64,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchThreadConfig {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) available_parallelism: Option<usize>,
    pub(crate) calculated_search_threads: usize,
    pub(crate) default_search_threads: usize,
    pub(crate) min_search_threads: usize,
    pub(crate) max_search_threads: usize,
    pub(crate) rust_env_var: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rust_env_search_threads: Option<usize>,
    pub(crate) source: &'static str,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchBenchmarkRunRequest {
    pub(crate) dto: Option<String>,
    pub(crate) version: Option<u16>,
    pub(crate) root: Option<String>,
    pub(crate) project_generation: Option<u64>,
    pub(crate) mode: Option<String>,
    pub(crate) suite_id: Option<String>,
    pub(crate) search_threads: Option<usize>,
    #[serde(default)]
    pub(crate) cases: Vec<SearchBenchmarkCase>,
    #[serde(default)]
    pub(crate) lanes: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchBenchmarkCase {
    pub(crate) case_id: Option<String>,
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
    pub(crate) search_threads: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchBenchmarkSuiteResult {
    pub(crate) dto: &'static str,
    pub(crate) version: u16,
    pub(crate) suite_id: String,
    pub(crate) mode: String,
    pub(crate) started_at_ms: u64,
    pub(crate) finished_at_ms: u64,
    pub(crate) status: &'static str,
    pub(crate) cases: Vec<SearchBenchmarkCaseResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchBenchmarkCaseResult {
    pub(crate) case_id: String,
    pub(crate) lane: &'static str,
    pub(crate) query: String,
    pub(crate) include_patterns: Vec<String>,
    pub(crate) exclude_patterns: Vec<String>,
    pub(crate) rust: SearchBenchmarkRustMetrics,
    pub(crate) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchBenchmarkRustMetrics {
    pub(crate) search_threads: usize,
    pub(crate) duration_ms: u64,
    pub(crate) first_result_ms: Option<u64>,
    pub(crate) files_scanned: usize,
    pub(crate) files_matched: usize,
    pub(crate) matches_found: usize,
    pub(crate) result_batches: usize,
    pub(crate) cancelled: bool,
    pub(crate) cancellation_reason: Option<String>,
    pub(crate) truncated_reason: Option<String>,
    pub(crate) dropped_optional_events: usize,
    pub(crate) required_event_failures: usize,
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

pub(crate) fn search_thread_config() -> SearchThreadConfig {
    let available_parallelism = available_parallelism_count();
    let calculated_search_threads = reduced_core_count(available_parallelism);
    let rust_env_search_threads = env::var(RUST_SEARCH_THREADS_ENV)
        .ok()
        .and_then(|value| parse_search_threads(&value));
    let default_search_threads = rust_env_search_threads
        .map(clamp_search_threads)
        .unwrap_or(calculated_search_threads);
    SearchThreadConfig {
        dto: "SearchThreadConfig",
        version: SEARCH_DTO_VERSION,
        available_parallelism,
        calculated_search_threads,
        default_search_threads,
        min_search_threads: MIN_SEARCH_THREADS,
        max_search_threads: MAX_SEARCH_THREADS,
        rust_env_var: RUST_SEARCH_THREADS_ENV,
        rust_env_search_threads,
        source: if rust_env_search_threads.is_some() {
            "rustEnv"
        } else {
            "availableParallelismMinusOne"
        },
    }
}

pub(crate) fn resolve_search_threads(search_threads: Option<usize>) -> usize {
    search_threads
        .filter(|value| *value > 0)
        .map(clamp_search_threads)
        .unwrap_or_else(|| search_thread_config().default_search_threads)
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

pub(crate) fn run_search_benchmark(
    request: SearchBenchmarkRunRequest,
) -> Result<SearchBenchmarkSuiteResult, SearchProviderError> {
    let root = resolve_root(request.root.as_deref())?;
    let mode = benchmark_mode(request.mode.as_deref())?;
    let suite_id = request
        .suite_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("search-benchmark-{}", epoch_ms()));
    let cases = benchmark_cases(mode, request.cases)?;
    let started_at_ms = epoch_ms();
    let mut results = Vec::with_capacity(cases.len());
    for case in cases {
        results.push(run_search_benchmark_case(
            &root,
            request.project_generation,
            request.search_threads,
            case,
        ));
    }
    let status = if results.iter().any(|case| case.status == "error") {
        "error"
    } else {
        "ok"
    };
    Ok(SearchBenchmarkSuiteResult {
        dto: "SearchBenchmarkSuiteResult",
        version: SEARCH_DTO_VERSION,
        suite_id,
        mode: mode.to_owned(),
        started_at_ms,
        finished_at_ms: epoch_ms(),
        status,
        cases: results,
    })
}

pub(crate) fn search_content_with_options(
    request: SearchContentRequest,
    options: SearchRunOptions,
) -> Result<SearchContentResult, SearchProviderError> {
    if is_multiline_query(&request.query) {
        return search_content_multiline_with_options(request, options);
    }

    if options.has_content_result_sink() && request.max_files.is_none() {
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
            set_truncation_reason(&mut truncated_reason, "matchLimit");
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
        let effective_cap_reason = match_cap_reason(request.max_matches_per_file, remaining_total);
        if explicit_cap_reached(0, effective_match_cap) {
            set_truncation_reason(&mut truncated_reason, effective_cap_reason);
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
                set_truncation_reason(&mut truncated_reason, effective_cap_reason);
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
        let file_truncated = sink.cap_reached && effective_cap_reason == "maxMatchesPerFile";
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
                files_scanned: Some(counts.files_scanned),
                next_global_cursor: None,
                truncated_reason: None,
                match_limit: request.max_matches_total,
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
        files_scanned: Some(counts.files_scanned),
        next_global_cursor: truncated.then(|| result_file_count.to_string()),
        truncated_reason,
        match_limit: request.max_matches_total,
        file_count: files.len(),
        match_count,
        files,
        truncated,
    })
}

fn search_content_multiline_with_options(
    request: SearchContentRequest,
    options: SearchRunOptions,
) -> Result<SearchContentResult, SearchProviderError> {
    let root = resolve_root(request.root.as_deref())?;
    let matcher = build_multiline_content_matcher(&request)?;
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

    for entry in build_walk(&root, false, request.use_ignore_files) {
        options.check_cancelled()?;
        let current_file_count = if stream_content_results {
            counts.files_matched
        } else {
            files.len()
        };
        if explicit_cap_reached(current_file_count, request.max_files) {
            set_truncation_reason(&mut truncated_reason, "maxFiles");
            break;
        }
        if explicit_cap_reached(match_count, request.max_matches_total) {
            set_truncation_reason(&mut truncated_reason, "matchLimit");
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

        let bytes = fs::read(path).map_err(|error| SearchProviderError::Io(error.to_string()))?;
        if bytes.contains(&b'\x00') {
            options.emit_progress(counts)?;
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let remaining_total = request
            .max_matches_total
            .map(|max_matches| max_matches.saturating_sub(match_count));
        let effective_match_cap = min_optional(request.max_matches_per_file, remaining_total);
        let effective_cap_reason = match_cap_reason(request.max_matches_per_file, remaining_total);
        if explicit_cap_reached(0, effective_match_cap) {
            set_truncation_reason(&mut truncated_reason, effective_cap_reason);
            break;
        }

        let mut matches = Vec::new();
        let mut file_cap_reached = false;
        for found in matcher.find_iter(&content) {
            if effective_match_cap.is_some_and(|max_matches| matches.len() >= max_matches) {
                file_cap_reached = true;
                break;
            }
            matches.push(content_multiline_match_dto(
                &content,
                found.start(),
                found.end(),
                context_chars,
            ));
            if effective_match_cap.is_some_and(|max_matches| matches.len() >= max_matches) {
                file_cap_reached = true;
                break;
            }
        }
        if file_cap_reached {
            set_truncation_reason(&mut truncated_reason, effective_cap_reason);
        }
        if matches.is_empty() {
            options.emit_progress(counts)?;
            continue;
        }

        let matches_returned = matches.len();
        match_count += matches_returned;
        counts.files_matched += 1;
        counts.matches_found = match_count;
        let file_truncated = file_cap_reached && effective_cap_reason == "maxMatchesPerFile";
        let file_result = SearchContentFile {
            path: path_to_string(path),
            relative_path,
            file_match_count: Some(matches_returned),
            matches_returned: Some(matches_returned),
            file_truncated: Some(file_truncated),
            next_match_cursor: file_truncated.then(|| matches_returned.to_string()),
            matches,
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
                files_scanned: Some(counts.files_scanned),
                next_global_cursor: None,
                truncated_reason: None,
                match_limit: request.max_matches_total,
                file_count: 1,
                match_count: matches_returned,
                files: vec![file_result],
                truncated: false,
            })?;
        } else {
            files.push(file_result);
        }
        options.emit_progress(counts)?;

        if request
            .max_matches_total
            .is_some_and(|max_matches| match_count >= max_matches)
        {
            set_truncation_reason(&mut truncated_reason, "matchLimit");
            break;
        }
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
        files_scanned: Some(counts.files_scanned),
        next_global_cursor: truncated.then(|| result_file_count.to_string()),
        truncated_reason,
        match_limit: request.max_matches_total,
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

fn build_multiline_content_matcher(
    request: &SearchContentRequest,
) -> Result<Regex, SearchProviderError> {
    let pattern = multiline_content_pattern(request);
    RegexBuilder::new(&pattern)
        .case_insensitive(!request.is_case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|error| SearchProviderError::InvalidRegex(error.to_string()))
}

fn multiline_content_pattern(request: &SearchContentRequest) -> String {
    let query = normalize_search_newlines(&request.query);
    let pattern = if request.is_regex {
        query.replace('\n', r"\r?\n")
    } else {
        escaped_multiline_literal_pattern(&query)
    };
    if request.is_whole_words {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    }
}

fn escaped_multiline_literal_pattern(query: &str) -> String {
    query
        .split('\n')
        .map(regex::escape)
        .collect::<Vec<_>>()
        .join(r"\r?\n")
}

fn normalize_search_newlines(query: &str) -> String {
    query.replace("\r\n", "\n").replace('\r', "\n")
}

fn is_multiline_query(query: &str) -> bool {
    query.contains('\n') || query.contains('\r')
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

fn content_multiline_match_dto(
    text: &str,
    match_start: usize,
    match_end: usize,
    context_chars: usize,
) -> SearchContentMatch {
    let (line_start, line_end) = containing_line_span(text, match_start, match_end);
    let snippet_start = previous_char_boundary(
        text,
        line_start.max(match_start.saturating_sub(context_chars)),
    );
    let snippet_end =
        next_char_boundary(text, line_end.min(match_end.saturating_add(context_chars)));
    let line_text = text.get(line_start..line_end).unwrap_or("").to_owned();
    let snippet = text
        .get(snippet_start..snippet_end)
        .unwrap_or("")
        .to_owned();
    let match_text = text.get(match_start..match_end).unwrap_or("").to_owned();
    SearchContentMatch {
        line_number: line_number_at_offset(text, match_start),
        column_number: match_start.saturating_sub(line_start) + 1,
        line_text,
        snippet,
        match_text,
        line_ranges: vec![SearchTextRange {
            start: match_start.saturating_sub(line_start),
            end: match_end.saturating_sub(line_start),
        }],
        snippet_ranges: vec![SearchTextRange {
            start: match_start.saturating_sub(snippet_start),
            end: match_end.saturating_sub(snippet_start),
        }],
    }
}

fn containing_line_span(text: &str, match_start: usize, match_end: usize) -> (usize, usize) {
    let start = match_start.min(text.len());
    let end = match_end.min(text.len());
    let line_start = text[..start]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let line_end = text[end..]
        .find('\n')
        .map(|index| end + index)
        .unwrap_or(text.len());
    (line_start, line_end)
}

fn line_number_at_offset(text: &str, offset: usize) -> u64 {
    text[..offset.min(text.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count() as u64
        + 1
}

fn previous_char_boundary(text: &str, offset: usize) -> usize {
    let mut index = offset.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn next_char_boundary(text: &str, offset: usize) -> usize {
    let mut index = offset.min(text.len());
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
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
        (_, Some(_)) => "matchLimit",
        _ => "maxMatchesPerFile",
    }
}

fn default_true() -> bool {
    true
}

fn available_parallelism_count() -> Option<usize> {
    std::thread::available_parallelism()
        .ok()
        .map(|count| count.get())
}

fn reduced_core_count(available_parallelism: Option<usize>) -> usize {
    available_parallelism
        .map(|cores| if cores > 1 { cores - 1 } else { 1 })
        .unwrap_or(4)
}

fn parse_search_threads(raw: &str) -> Option<usize> {
    raw.trim().parse::<usize>().ok().filter(|value| *value > 0)
}

fn clamp_search_threads(value: usize) -> usize {
    value.clamp(MIN_SEARCH_THREADS, MAX_SEARCH_THREADS)
}

fn benchmark_mode(mode: Option<&str>) -> Result<&'static str, SearchProviderError> {
    match mode.unwrap_or("genericSuite") {
        "genericSuite" => Ok("genericSuite"),
        "oneShot" => Ok("oneShot"),
        other => Err(SearchProviderError::InvalidRequest(format!(
            "unsupported search benchmark mode: {other}"
        ))),
    }
}

fn benchmark_cases(
    mode: &str,
    cases: Vec<SearchBenchmarkCase>,
) -> Result<Vec<SearchBenchmarkCase>, SearchProviderError> {
    if !cases.is_empty() {
        return Ok(cases);
    }
    if mode == "oneShot" {
        return Err(SearchProviderError::InvalidRequest(
            "oneShot search benchmark requires at least one case".to_owned(),
        ));
    }
    Ok(vec![
        SearchBenchmarkCase {
            case_id: Some("raw-import".to_owned()),
            query: "import".to_owned(),
            use_ignore_files: true,
            ..Default::default()
        },
        SearchBenchmarkCase {
            case_id: Some("include-py".to_owned()),
            query: "import".to_owned(),
            include_patterns: vec!["*.py".to_owned()],
            use_ignore_files: true,
            ..Default::default()
        },
        SearchBenchmarkCase {
            case_id: Some("exclude-ts".to_owned()),
            query: "import".to_owned(),
            exclude_patterns: vec!["*.ts".to_owned()],
            use_ignore_files: true,
            ..Default::default()
        },
        SearchBenchmarkCase {
            case_id: Some("include-under-exclude-ts".to_owned()),
            query: "import".to_owned(),
            include_patterns: vec!["*_*".to_owned()],
            exclude_patterns: vec!["*.ts".to_owned()],
            use_ignore_files: true,
            ..Default::default()
        },
    ])
}

fn run_search_benchmark_case(
    root: &Path,
    project_generation: Option<u64>,
    suite_search_threads: Option<usize>,
    case: SearchBenchmarkCase,
) -> SearchBenchmarkCaseResult {
    let case_id = case
        .case_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| "one-shot".to_owned());
    let include_patterns = case.include_patterns.clone();
    let exclude_patterns = case.exclude_patterns.clone();
    let search_threads = resolve_search_threads(case.search_threads.or(suite_search_threads));
    let request = SearchContentRequest {
        root: Some(path_to_string(root)),
        project_generation,
        query: case.query.clone(),
        is_regex: case.is_regex,
        is_case_sensitive: case.is_case_sensitive,
        is_whole_words: case.is_whole_words,
        include_patterns: case.include_patterns,
        exclude_patterns: case.exclude_patterns,
        use_ignore_files: case.use_ignore_files,
        max_files: case.max_files,
        max_matches_per_file: case.max_matches_per_file,
        max_matches_total: case.max_matches_total,
        max_file_size_bytes: case.max_file_size_bytes,
        context_chars: case.context_chars,
        search_threads: Some(search_threads),
        ..Default::default()
    };
    let counts = Arc::new(std::sync::Mutex::new(SearchProgressCounts::default()));
    let result_batches = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let first_result_ms = Arc::new(std::sync::Mutex::new(None::<u64>));
    let started_at = Instant::now();
    let progress_counts = Arc::clone(&counts);
    let batch_counter = Arc::clone(&result_batches);
    let first_result_slot = Arc::clone(&first_result_ms);
    let options = SearchRunOptions {
        progress: Some(Arc::new(move |next_counts| {
            if let Ok(mut counts) = progress_counts.lock() {
                *counts = next_counts;
            }
            true
        })),
        content_result: Some(Arc::new(move |_| {
            batch_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if let Ok(mut first_result_ms) = first_result_slot.lock() {
                if first_result_ms.is_none() {
                    *first_result_ms = Some(started_at.elapsed().as_millis() as u64);
                }
            }
            true
        })),
        ..Default::default()
    };
    let search_result = search_content_with_options(request, options);
    let duration_ms = started_at.elapsed().as_millis() as u64;
    let counts = counts.lock().map(|counts| *counts).unwrap_or_default();
    let first_result_ms = first_result_ms.lock().ok().and_then(|value| *value);
    match search_result {
        Ok(result) => SearchBenchmarkCaseResult {
            case_id,
            lane: "rustOnly",
            query: case.query,
            include_patterns,
            exclude_patterns,
            rust: SearchBenchmarkRustMetrics {
                search_threads,
                duration_ms,
                first_result_ms,
                files_scanned: result.files_scanned.unwrap_or(counts.files_scanned),
                files_matched: result
                    .total_file_count
                    .unwrap_or_else(|| counts.files_matched.max(result.file_count)),
                matches_found: result
                    .total_match_count
                    .unwrap_or_else(|| counts.matches_found.max(result.match_count)),
                result_batches: result_batches.load(std::sync::atomic::Ordering::Relaxed),
                cancelled: false,
                cancellation_reason: None,
                truncated_reason: result.truncated_reason,
                dropped_optional_events: 0,
                required_event_failures: 0,
            },
            status: "ok",
            error: None,
        },
        Err(error) => SearchBenchmarkCaseResult {
            case_id,
            lane: "rustOnly",
            query: case.query,
            include_patterns,
            exclude_patterns,
            rust: SearchBenchmarkRustMetrics {
                search_threads,
                duration_ms,
                first_result_ms,
                files_scanned: counts.files_scanned,
                files_matched: counts.files_matched,
                matches_found: counts.matches_found,
                result_batches: result_batches.load(std::sync::atomic::Ordering::Relaxed),
                cancelled: matches!(error, SearchProviderError::Cancelled),
                cancellation_reason: matches!(error, SearchProviderError::Cancelled)
                    .then(|| "rustCancelled".to_owned()),
                truncated_reason: None,
                dropped_optional_events: 0,
                required_event_failures: 0,
            },
            status: "error",
            error: Some(search_provider_error_text(error)),
        },
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn search_provider_error_text(error: SearchProviderError) -> String {
    match error {
        SearchProviderError::MissingRoot => "missing root".to_owned(),
        SearchProviderError::InvalidRoot(message)
        | SearchProviderError::InvalidPattern(message)
        | SearchProviderError::InvalidRegex(message)
        | SearchProviderError::InvalidRequest(message)
        | SearchProviderError::Io(message)
        | SearchProviderError::Search(message) => message,
        SearchProviderError::Cancelled => "search cancelled".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeSet, path::Path, time::Instant};

    fn test_root(name: &str) -> PathBuf {
        let mut root = std::env::var_os("TEMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        root.push(format!("te2-server-search-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn write_file(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, body).expect("write file");
    }

    fn content_request(root: &Path) -> SearchContentRequest {
        SearchContentRequest {
            root: Some(path_to_string(root)),
            query: "import".to_owned(),
            is_case_sensitive: true,
            use_ignore_files: false,
            ..Default::default()
        }
    }

    fn result_paths(result: &SearchContentResult) -> BTreeSet<String> {
        result
            .files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect()
    }

    fn seed_import_fixture(root: &Path) {
        write_file(root, "pkg/main.py", "import os\n");
        write_file(root, "pkg/util_module.py", "from thing import value\n");
        write_file(root, "src/app.ts", "import { x } from './x'\n");
        write_file(root, "src/app_test.ts", "import test from 'test'\n");
        write_file(root, "docs/readme.md", "import docs\n");
        write_file(root, "docs/with_under.md", "import under\n");
        write_file(root, "notes/nohit.txt", "nothing here\n");
    }

    const BENCH_GROUP_FILES: usize = 80;
    const BENCH_MATCHES_PER_FILE: usize = 4;

    fn seed_import_rate_fixture(root: &Path) {
        for index in 0..BENCH_GROUP_FILES {
            let mut body = String::new();
            for match_index in 0..BENCH_MATCHES_PER_FILE {
                body.push_str(&format!("import py_module_{index}_{match_index}\n"));
            }
            body.push_str("const untouched = true;\n");
            write_file(root, &format!("pkg_py/module_{index}.py"), &body);
        }
        for index in 0..BENCH_GROUP_FILES {
            let mut body = String::new();
            for match_index in 0..BENCH_MATCHES_PER_FILE {
                body.push_str(&format!("import tsModule{index}_{match_index}\n"));
            }
            body.push_str("export const untouched = true;\n");
            write_file(root, &format!("src_ts/component_{index}.ts"), &body);
        }
        for index in 0..BENCH_GROUP_FILES {
            let mut body = String::new();
            for match_index in 0..BENCH_MATCHES_PER_FILE {
                body.push_str(&format!("import docs_module_{index}_{match_index}\n"));
            }
            body.push_str("plain markdown text\n");
            write_file(root, &format!("docs/with_under_{index}.md"), &body);
        }
        for index in 0..BENCH_GROUP_FILES {
            let mut body = String::new();
            for match_index in 0..BENCH_MATCHES_PER_FILE {
                body.push_str(&format!("import noteModule{index}_{match_index}\n"));
            }
            body.push_str("plain text\n");
            write_file(root, &format!("notes/note-{index}.txt"), &body);
        }
    }

    fn expected_bench_matches(files: usize) -> usize {
        files * BENCH_MATCHES_PER_FILE
    }

    fn run_import_rate_benchmark(
        case: &str,
        include_patterns: &[&str],
        exclude_patterns: &[&str],
        expected_files: usize,
    ) {
        let root = test_root(case);
        seed_import_rate_fixture(&root);

        let emitted_matches = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let emitted_files = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let result_matches = std::sync::Arc::clone(&emitted_matches);
        let result_files = std::sync::Arc::clone(&emitted_files);

        let mut request = content_request(&root);
        request.include_patterns = include_patterns
            .iter()
            .map(|pattern| (*pattern).to_owned())
            .collect();
        request.exclude_patterns = exclude_patterns
            .iter()
            .map(|pattern| (*pattern).to_owned())
            .collect();
        let options = SearchRunOptions {
            search_id: Some(format!("test-search-{case}")),
            job_id: Some(format!("test-job-{case}")),
            content_result: Some(std::sync::Arc::new(move |result| {
                result_matches.fetch_add(result.match_count, std::sync::atomic::Ordering::Relaxed);
                result_files.fetch_add(result.file_count, std::sync::atomic::Ordering::Relaxed);
                true
            })),
            ..Default::default()
        };

        let started_at = Instant::now();
        let result = search_content_with_options(request, options).expect("rate search");
        let elapsed = started_at.elapsed();
        let seconds = elapsed.as_secs_f64().max(0.001);
        let emitted_match_count = emitted_matches.load(std::sync::atomic::Ordering::Relaxed);
        let emitted_file_count = emitted_files.load(std::sync::atomic::Ordering::Relaxed);
        let expected_matches = expected_bench_matches(expected_files);

        assert_eq!(result.match_count, expected_matches);
        assert_eq!(result.total_match_count, Some(expected_matches));
        assert_eq!(result.total_file_count, Some(expected_files));
        assert_eq!(emitted_match_count, expected_matches);
        assert_eq!(emitted_file_count, expected_files);

        println!(
            "SEARCH_RATE_BENCH case={} query=import include={:?} exclude={:?} expected_files={} emitted_files={} matches={} duration_ms={} hits_per_second={:.2} matched_files_per_second={:.2}",
            case,
            include_patterns,
            exclude_patterns,
            expected_files,
            emitted_file_count,
            emitted_match_count,
            elapsed.as_millis(),
            emitted_match_count as f64 / seconds,
            emitted_file_count as f64 / seconds,
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn content_search_import_variants_apply_include_exclude_filters() {
        let root = test_root("import-variants");
        seed_import_fixture(&root);

        let raw = search_content(content_request(&root)).expect("raw search");
        assert_eq!(raw.match_count, 6);
        assert_eq!(
            result_paths(&raw),
            BTreeSet::from([
                "docs/readme.md".to_owned(),
                "docs/with_under.md".to_owned(),
                "pkg/main.py".to_owned(),
                "pkg/util_module.py".to_owned(),
                "src/app.ts".to_owned(),
                "src/app_test.ts".to_owned(),
            ])
        );

        let mut include_py = content_request(&root);
        include_py.include_patterns = vec!["*.py".to_owned()];
        let include_py = search_content(include_py).expect("include py search");
        assert_eq!(include_py.match_count, 2);
        assert_eq!(
            result_paths(&include_py),
            BTreeSet::from(["pkg/main.py".to_owned(), "pkg/util_module.py".to_owned()])
        );

        let mut exclude_ts = content_request(&root);
        exclude_ts.exclude_patterns = vec!["*.ts".to_owned()];
        let exclude_ts = search_content(exclude_ts).expect("exclude ts search");
        assert_eq!(exclude_ts.match_count, 4);
        assert_eq!(
            result_paths(&exclude_ts),
            BTreeSet::from([
                "docs/readme.md".to_owned(),
                "docs/with_under.md".to_owned(),
                "pkg/main.py".to_owned(),
                "pkg/util_module.py".to_owned(),
            ])
        );

        let mut include_under_exclude_ts = content_request(&root);
        include_under_exclude_ts.include_patterns = vec!["*_*".to_owned()];
        include_under_exclude_ts.exclude_patterns = vec!["*.ts".to_owned()];
        let include_under_exclude_ts =
            search_content(include_under_exclude_ts).expect("include underscore exclude ts search");
        assert_eq!(include_under_exclude_ts.match_count, 2);
        assert_eq!(
            result_paths(&include_under_exclude_ts),
            BTreeSet::from([
                "docs/with_under.md".to_owned(),
                "pkg/util_module.py".to_owned(),
            ])
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn content_search_multiline_literal_matches_lf_and_crlf() {
        let root = test_root("multiline-literal");
        write_file(
            &root,
            "src/lf.txt",
            "alpha\nneedle one\nneedle two\nomega\n",
        );
        write_file(
            &root,
            "src/crlf.txt",
            "alpha\r\nneedle one\r\nneedle two\r\nomega\r\n",
        );

        let mut request = content_request(&root);
        request.query = "needle one\nneedle two".to_owned();
        let result = search_content(request).expect("multiline literal search");

        assert_eq!(result.match_count, 2);
        assert_eq!(
            result_paths(&result),
            BTreeSet::from(["src/crlf.txt".to_owned(), "src/lf.txt".to_owned()])
        );
        let first_match = &result.files[0].matches[0];
        assert_eq!(first_match.line_number, 2);
        assert_eq!(first_match.column_number, 1);
        assert!(first_match.match_text.contains("needle one"));
        assert!(first_match.match_text.contains("needle two"));
        assert_eq!(first_match.snippet_ranges.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn content_search_multiline_regex_allows_actual_newline() {
        let root = test_root("multiline-regex");
        write_file(&root, "src/app.ts", "before\nfoo_123\nbar_456\nafter\n");

        let mut request = content_request(&root);
        request.query = r"foo_\d+
bar_\d+"
            .to_owned();
        request.is_regex = true;
        let result = search_content(request).expect("multiline regex search");

        assert_eq!(result.match_count, 1);
        let found = &result.files[0].matches[0];
        assert_eq!(found.line_number, 2);
        assert_eq!(found.column_number, 1);
        assert_eq!(found.match_text, "foo_123\nbar_456");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn content_search_progress_callback_can_cancel_provider() {
        let root = test_root("cancel-progress");
        seed_import_fixture(&root);
        let cancelled = Arc::new(AtomicBool::new(false));
        let callback_cancelled = Arc::clone(&cancelled);
        let options = SearchRunOptions {
            cancelled: Some(Arc::clone(&cancelled)),
            progress: Some(Arc::new(move |_| {
                callback_cancelled.store(true, Ordering::Relaxed);
                false
            })),
            ..Default::default()
        };

        let result = search_content_with_options(content_request(&root), options);
        assert!(matches!(result, Err(SearchProviderError::Cancelled)));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn content_search_match_limit_stays_progressive_and_reports_cap() {
        let root = test_root("match-limit");
        for index in 0..20 {
            write_file(
                &root,
                &format!("src/file_{index}.rs"),
                &format!("// import match {index}\n"),
            );
        }

        let emitted_matches = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let emitted_files = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let result_frames = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let result_matches = Arc::clone(&emitted_matches);
        let result_files = Arc::clone(&emitted_files);
        let frame_count = Arc::clone(&result_frames);

        let mut request = content_request(&root);
        request.max_matches_total = Some(5);
        let options = SearchRunOptions {
            search_id: Some("match-limit-search".to_owned()),
            job_id: Some("match-limit-job".to_owned()),
            content_result: Some(Arc::new(move |result| {
                frame_count.fetch_add(1, Ordering::Relaxed);
                result_matches.fetch_add(result.match_count, Ordering::Relaxed);
                result_files.fetch_add(result.file_count, Ordering::Relaxed);
                true
            })),
            ..Default::default()
        };

        let result = search_content_with_options(request, options).expect("limited search");
        assert_eq!(result.match_count, 5);
        assert_eq!(result.total_match_count, Some(5));
        assert_eq!(result.total_file_count, Some(5));
        assert_eq!(result.truncated_reason.as_deref(), Some("matchLimit"));
        assert_eq!(result.match_limit, Some(5));
        assert_eq!(result.complete, Some(false));
        assert!(result.truncated);
        assert_eq!(emitted_matches.load(Ordering::Relaxed), 5);
        assert_eq!(emitted_files.load(Ordering::Relaxed), 5);
        assert_eq!(result_frames.load(Ordering::Relaxed), 5);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_benchmark_uses_terminal_totals_without_progress_frame() {
        let root = test_root("benchmark-terminal-totals");
        seed_import_rate_fixture(&root);

        let case = SearchBenchmarkCase {
            case_id: Some("include-py".to_owned()),
            query: "import".to_owned(),
            include_patterns: vec!["*.py".to_owned()],
            use_ignore_files: false,
            ..Default::default()
        };
        let result = run_search_benchmark_case(&root, None, None, case);
        let expected_matches = expected_bench_matches(BENCH_GROUP_FILES);

        assert_eq!(result.status, "ok");
        assert_eq!(result.rust.files_scanned, BENCH_GROUP_FILES);
        assert_eq!(result.rust.files_matched, BENCH_GROUP_FILES);
        assert_eq!(result.rust.matches_found, expected_matches);
        assert_eq!(result.rust.result_batches, BENCH_GROUP_FILES);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_benchmark_reports_requested_thread_count() {
        let root = test_root("benchmark-thread-count");
        seed_import_fixture(&root);

        let case = SearchBenchmarkCase {
            case_id: Some("threaded".to_owned()),
            query: "import".to_owned(),
            use_ignore_files: false,
            ..Default::default()
        };
        let result = run_search_benchmark_case(&root, None, Some(2), case);

        assert_eq!(result.status, "ok");
        assert_eq!(result.rust.search_threads, 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_thread_config_reports_calculated_default() {
        let config = search_thread_config();

        assert_eq!(config.dto, "SearchThreadConfig");
        assert!(config.default_search_threads >= MIN_SEARCH_THREADS);
        assert!(config.default_search_threads <= MAX_SEARCH_THREADS);
        assert!(config.calculated_search_threads >= MIN_SEARCH_THREADS);
    }

    #[test]
    #[ignore = "benchmark-style search rate report; run with --ignored --nocapture"]
    fn content_search_import_rate_raw_for_tests() {
        run_import_rate_benchmark("raw", &[], &[], BENCH_GROUP_FILES * 4);
    }

    #[test]
    #[ignore = "benchmark-style search rate report; run with --ignored --nocapture"]
    fn content_search_import_rate_include_py_for_tests() {
        run_import_rate_benchmark("include-py", &["*.py"], &[], BENCH_GROUP_FILES);
    }

    #[test]
    #[ignore = "benchmark-style search rate report; run with --ignored --nocapture"]
    fn content_search_import_rate_exclude_ts_for_tests() {
        run_import_rate_benchmark("exclude-ts", &[], &["*.ts"], BENCH_GROUP_FILES * 3);
    }
    // te2_search_canary_05

    #[test]
    #[ignore = "benchmark-style search rate report; run with --ignored --nocapture"]
    fn content_search_import_rate_include_under_exclude_ts_for_tests() {
        run_import_rate_benchmark(
            "include-under-exclude-ts",
            &["*_*"],
            &["*.ts"],
            BENCH_GROUP_FILES * 2,
        );
    }
}
