use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use std::{
    io,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use super::*;
use crate::framework_services::common::path_to_string;

const DEFAULT_PROGRESS_BATCH_FILES: usize = 256;

// Source copy basis:
// - BurntSushi/ripgrep@dfe4a81d2591daca76d25ae4e052c34b26578155
// - crates/core/main.rs: search_parallel
// - crates/core/search.rs: SearchWorker single-thread/per-worker contract
//
// The copied ripgrep control-flow excerpt is retained here with CLI output,
// stats, and printer branches commented out because TE2 emits structured DTOs
// instead of stdout buffers.
//
// ```rust,ignore
// /// The top-level entry point for multi-threaded search.
// ///
// /// The parallelism is itself achieved by the recursive directory traversal.
// /// All we need to do is feed it a worker for performing a search on each file.
// ///
// /// Requesting a sorted output from ripgrep (such as with `--sort path`) will
// /// automatically disable parallelism and hence sorting is not handled here.
// fn search_parallel(args: &HiArgs, mode: SearchMode) -> anyhow::Result<bool> {
//     use std::sync::atomic::{AtomicBool, Ordering};
//
//     let started_at = std::time::Instant::now();
//     let haystack_builder = args.haystack_builder();
//     let bufwtr = args.buffer_writer();
//     let stats = args.stats().map(std::sync::Mutex::new);
//     let matched = AtomicBool::new(false);
//     let searched = AtomicBool::new(false);
//
//     let mut searcher = args.search_worker(
//         args.matcher()?,
//         args.searcher()?,
//         args.printer(mode, bufwtr.buffer()),
//     )?;
//     args.walk_builder()?.build_parallel().run(|| {
//         let bufwtr = &bufwtr;
//         let stats = &stats;
//         let matched = &matched;
//         let searched = &searched;
//         let haystack_builder = &haystack_builder;
//         let mut searcher = searcher.clone();
//
//         Box::new(move |result| {
//             let haystack = match haystack_builder.build_from_result(result) {
//                 Some(haystack) => haystack,
//                 None => return WalkState::Continue,
//             };
//             searched.store(true, Ordering::SeqCst);
//             searcher.printer().get_mut().clear();
//             let search_result = match searcher.search(&haystack) {
//                 Ok(search_result) => search_result,
//                 Err(err) => {
//                     err_message!("{}: {}", haystack.path().display(), err);
//                     return WalkState::Continue;
//                 }
//             };
//             if search_result.has_match() {
//                 matched.store(true, Ordering::SeqCst);
//             }
//             // TE2 does not print ripgrep stats here.
//             // if let Some(ref locked_stats) = *stats {
//             //     let mut stats = locked_stats.lock().unwrap();
//             //     *stats += search_result.stats().unwrap();
//             // }
//             // TE2 emits SearchContentResult DTOs instead of printing.
//             // if let Err(err) = bufwtr.print(searcher.printer().get_mut()) {
//             //     if err.kind() == std::io::ErrorKind::BrokenPipe {
//             //         return WalkState::Quit;
//             //     }
//             //     err_message!("{}: {}", haystack.path().display(), err);
//             // }
//             if matched.load(Ordering::SeqCst) && args.quit_after_match() {
//                 WalkState::Quit
//             } else {
//                 WalkState::Continue
//             }
//         })
//     });
//     // TE2 does not print the implicit-path warning or stats footer here.
//     // if args.has_implicit_path() && !searched.load(Ordering::SeqCst) {
//     //     eprint_nothing_searched();
//     // }
//     // if let Some(ref locked_stats) = stats {
//     //     let stats = locked_stats.lock().unwrap();
//     //     let mut wtr = searcher.printer().get_mut();
//     //     let _ = print_stats(mode, &stats, started_at, &mut wtr);
//     //     let _ = bufwtr.print(&mut wtr);
//     // }
//     Ok(matched.load(Ordering::SeqCst))
// }
//
// /// A worker for executing searches.
// ///
// /// It is intended for a single worker to execute many searches, and is
// /// generally intended to be used from a single thread. When searching using
// /// multiple threads, it is better to create a new worker for each thread.
// #[derive(Clone, Debug)]
// pub(crate) struct SearchWorker<W> { /* ripgrep worker fields */ }
// ```

pub(super) fn search_content_parallel_with_options(
    request: SearchContentRequest,
    options: SearchRunOptions,
) -> Result<SearchContentResult, SearchProviderError> {
    let root = Arc::new(resolve_root(request.root.as_deref())?);
    let include = Arc::new(build_glob_set(&request.include_patterns)?);
    let exclude = Arc::new(build_glob_set(&request.exclude_patterns)?);
    let context_chars = cap_usize(
        request.context_chars,
        DEFAULT_CONTEXT_CHARS,
        PROVIDER_MAX_CONTEXT_CHARS,
    );
    let matcher = Arc::new(build_content_matcher(&request)?);
    let search_threads = resolve_search_threads(request.search_threads);

    let request = Arc::new(request);
    let options = Arc::new(options);
    let files_scanned = Arc::new(AtomicUsize::new(0));
    let files_matched = Arc::new(AtomicUsize::new(0));
    let matches_found = Arc::new(AtomicUsize::new(0));
    let next_progress_at = Arc::new(AtomicUsize::new(DEFAULT_PROGRESS_BATCH_FILES));
    let truncated_reason = Arc::new(Mutex::new(None::<String>));
    let first_error = Arc::new(Mutex::new(None::<SearchProviderError>));

    build_parallel_walk(&root, request.use_ignore_files, search_threads).run(|| {
        let root = Arc::clone(&root);
        let request = Arc::clone(&request);
        let options = Arc::clone(&options);
        let include = Arc::clone(&include);
        let exclude = Arc::clone(&exclude);
        let files_scanned = Arc::clone(&files_scanned);
        let files_matched = Arc::clone(&files_matched);
        let matches_found = Arc::clone(&matches_found);
        let next_progress_at = Arc::clone(&next_progress_at);
        let truncated_reason = Arc::clone(&truncated_reason);
        let first_error = Arc::clone(&first_error);
        let matcher = Arc::clone(&matcher);

        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .build();

        Box::new(move |result| {
            if has_error(&first_error) {
                return WalkState::Quit;
            }
            if let Err(error) = options.check_cancelled() {
                set_first_error(&first_error, error);
                return WalkState::Quit;
            }
            if request
                .max_matches_total
                .is_some_and(|max| matches_found.load(Ordering::Relaxed) >= max)
            {
                set_parallel_truncation(&truncated_reason, "matchLimit");
                return WalkState::Quit;
            }

            let entry = match result {
                Ok(entry) => entry,
                Err(_) => return WalkState::Continue,
            };
            if !entry_is_file(&entry) {
                return WalkState::Continue;
            }
            let path = entry.path();
            let Some(relative_path) = relative_posix(&root, path) else {
                return WalkState::Continue;
            };
            let name = entry_name(&entry);
            if !path_allowed(&relative_path, &name, &include, &exclude) {
                return WalkState::Continue;
            }

            let scanned = files_scanned.fetch_add(1, Ordering::Relaxed) + 1;
            if request
                .max_file_size_bytes
                .is_some_and(|max_bytes| is_too_large(path, max_bytes))
            {
                set_parallel_truncation(&truncated_reason, "maxFileSizeBytes");
                return emit_batched_parallel_progress(
                    &next_progress_at,
                    &options,
                    &first_error,
                    scanned,
                    files_matched.load(Ordering::Relaxed),
                    matches_found.load(Ordering::Relaxed),
                );
            }

            let remaining_total = request.max_matches_total.map(|max_matches| {
                max_matches.saturating_sub(matches_found.load(Ordering::Relaxed))
            });
            let effective_match_cap = min_optional(request.max_matches_per_file, remaining_total);
            let effective_cap_reason =
                match_cap_reason(request.max_matches_per_file, remaining_total);
            if explicit_cap_reached(0, effective_match_cap) {
                set_parallel_truncation(&truncated_reason, effective_cap_reason);
                return WalkState::Quit;
            }

            let mut sink = ContentSink {
                matcher: matcher.as_ref(),
                max_matches_per_file: effective_match_cap,
                context_chars,
                matches: Vec::new(),
                cap_reached: false,
            };
            match searcher.search_path(matcher.as_ref(), path, &mut sink) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::Interrupted && sink.cap_reached => {
                    set_parallel_truncation(&truncated_reason, effective_cap_reason);
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                    set_parallel_truncation(&truncated_reason, "interrupted");
                }
                Err(error) => {
                    set_first_error(&first_error, SearchProviderError::Search(error.to_string()));
                    return WalkState::Quit;
                }
            }
            if sink.matches.is_empty() {
                return emit_batched_parallel_progress(
                    &next_progress_at,
                    &options,
                    &first_error,
                    scanned,
                    files_matched.load(Ordering::Relaxed),
                    matches_found.load(Ordering::Relaxed),
                );
            }

            let raw_matches_returned = sink.matches.len();
            let (matches_returned, match_limit_reached) = reserve_match_capacity(
                &matches_found,
                request.max_matches_total,
                raw_matches_returned,
            );
            if matches_returned == 0 {
                set_parallel_truncation(&truncated_reason, "matchLimit");
                return WalkState::Quit;
            }
            if matches_returned < raw_matches_returned {
                sink.matches.truncate(matches_returned);
            }
            if match_limit_reached {
                set_parallel_truncation(&truncated_reason, "matchLimit");
            }
            let matched = files_matched.fetch_add(1, Ordering::Relaxed) + 1;
            let found = matches_found.load(Ordering::Relaxed);
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
            let result = SearchContentResult {
                dto: "SearchContentResult",
                version: SEARCH_DTO_VERSION,
                root: path_to_string(&root),
                project_generation: request.project_generation,
                query: request.query.clone(),
                search_id: options.search_id.clone(),
                job_id: options.job_id.clone(),
                complete: Some(false),
                total_file_count: Some(matched),
                total_match_count: Some(found),
                files_scanned: Some(scanned),
                next_global_cursor: None,
                truncated_reason: None,
                match_limit: request.max_matches_total,
                file_count: 1,
                match_count: matches_returned,
                files: vec![file_result],
                truncated: false,
            };
            if let Err(error) = options.emit_content_result(result) {
                set_first_error(&first_error, error);
                return WalkState::Quit;
            }
            if match_limit_reached {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    if let Some(error) = take_first_error(&first_error) {
        return Err(error);
    }

    let truncated_reason = take_truncation_reason(&truncated_reason);
    let truncated = truncated_reason.is_some();
    let file_count = files_matched.load(Ordering::Relaxed);
    let match_count = matches_found.load(Ordering::Relaxed);
    Ok(SearchContentResult {
        dto: "SearchContentResult",
        version: SEARCH_DTO_VERSION,
        root: path_to_string(&root),
        project_generation: request.project_generation,
        query: request.query.clone(),
        search_id: options.search_id.clone(),
        job_id: options.job_id.clone(),
        complete: Some(!truncated),
        total_file_count: Some(file_count),
        total_match_count: Some(match_count),
        files_scanned: Some(files_scanned.load(Ordering::Relaxed)),
        next_global_cursor: None,
        truncated_reason,
        match_limit: request.max_matches_total,
        file_count: 0,
        match_count,
        files: Vec::new(),
        truncated,
    })
}

fn reserve_match_capacity(
    matches_found: &AtomicUsize,
    max_matches_total: Option<usize>,
    requested: usize,
) -> (usize, bool) {
    let Some(max_matches_total) = max_matches_total else {
        let _ = matches_found.fetch_add(requested, Ordering::Relaxed);
        return (requested, false);
    };

    loop {
        let current = matches_found.load(Ordering::Relaxed);
        if current >= max_matches_total {
            return (0, true);
        }
        let accepted = requested.min(max_matches_total - current);
        let updated = current + accepted;
        if matches_found
            .compare_exchange(current, updated, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            return (accepted, updated >= max_matches_total);
        }
    }
}

fn build_parallel_walk(
    root: &Path,
    use_ignore_files: bool,
    search_threads: usize,
) -> ignore::WalkParallel {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(true)
        .parents(use_ignore_files)
        .ignore(use_ignore_files)
        .git_ignore(use_ignore_files)
        .git_global(use_ignore_files)
        .git_exclude(use_ignore_files)
        .follow_links(false)
        .threads(search_threads);
    builder.build_parallel()
}

fn emit_batched_parallel_progress(
    next_progress_at: &AtomicUsize,
    options: &SearchRunOptions,
    first_error: &Mutex<Option<SearchProviderError>>,
    files_scanned: usize,
    files_matched: usize,
    matches_found: usize,
) -> WalkState {
    if !should_emit_progress(next_progress_at, files_scanned) {
        return WalkState::Continue;
    }
    let counts = SearchProgressCounts {
        files_scanned,
        files_matched,
        matches_found,
    };
    match options.emit_progress(counts) {
        Ok(()) => WalkState::Continue,
        Err(error) => {
            set_first_error(first_error, error);
            WalkState::Quit
        }
    }
}

fn should_emit_progress(next_progress_at: &AtomicUsize, files_scanned: usize) -> bool {
    loop {
        let next = next_progress_at.load(Ordering::Relaxed);
        if files_scanned < next {
            return false;
        }
        let mut updated = next.saturating_add(DEFAULT_PROGRESS_BATCH_FILES);
        while updated <= files_scanned {
            updated = updated.saturating_add(DEFAULT_PROGRESS_BATCH_FILES);
            if updated == usize::MAX {
                break;
            }
        }
        if next_progress_at
            .compare_exchange(next, updated, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            return true;
        }
    }
}

fn set_parallel_truncation(reason: &Mutex<Option<String>>, value: &str) {
    if let Ok(mut reason) = reason.lock() {
        set_truncation_reason(&mut reason, value);
    }
}

fn take_truncation_reason(reason: &Mutex<Option<String>>) -> Option<String> {
    reason.lock().ok().and_then(|mut reason| reason.take())
}

fn set_first_error(slot: &Mutex<Option<SearchProviderError>>, error: SearchProviderError) {
    if let Ok(mut slot) = slot.lock() {
        if slot.is_none() {
            *slot = Some(error);
        }
    }
}

fn has_error(slot: &Mutex<Option<SearchProviderError>>) -> bool {
    slot.lock().map(|slot| slot.is_some()).unwrap_or(true)
}

fn take_first_error(slot: &Mutex<Option<SearchProviderError>>) -> Option<SearchProviderError> {
    slot.lock().ok().and_then(|mut slot| slot.take())
}
