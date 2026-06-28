use serde_json::json;
use std::sync::Arc;

use super::{
    PipeEventSink,
    protocol::{PipeEnvelope, PipeError, PipeIdentity},
};
use crate::framework_services::{
    scheduler::FrameworkServiceScheduler,
    search_ops::{self, SearchProviderError},
};

// Pipe adapter boundary: decode JSON-RPC params into provider DTOs, inherit
// envelope routing context, and encode typed provider errors back to the caller.
pub(super) async fn dispatch_search_request(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
) -> Option<PipeEnvelope> {
    match request.method.as_deref()? {
        "search.files.get" => Some(search_files(request, responder, scheduler).await),
        "search.content.get" => Some(search_content(request, responder, scheduler).await),
        "search.files.start" => {
            Some(search_files_start(request, responder, scheduler, event_sink).await)
        }
        "search.content.start" => {
            Some(search_content_start(request, responder, scheduler, event_sink).await)
        }
        "search.job.cancel" => Some(search_job_cancel(request, responder, scheduler).await),
        _ => None,
    }
}

async fn search_files(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<search_ops::SearchFilesRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid search.files.get params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    if let Err(error) = search_ops::validate_contract_metadata(
        params.dto.as_deref(),
        params.version,
        "SearchFilesRequest",
    ) {
        return PipeEnvelope::error_response(request, responder, search_error(error));
    }
    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }
    encode_result(request, responder, scheduler.search_files(params).await)
}

async fn search_content(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<search_ops::SearchContentRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid search.content.get params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    if let Err(error) = search_ops::validate_contract_metadata(
        params.dto.as_deref(),
        params.version,
        "SearchContentRequest",
    ) {
        return PipeEnvelope::error_response(request, responder, search_error(error));
    }
    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }
    encode_result(request, responder, scheduler.search_content(params).await)
}

async fn search_files_start(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<search_ops::SearchFilesStartRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid search.files.start params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    if let Err(error) = search_ops::validate_contract_metadata(
        params.dto.as_deref(),
        params.version,
        "SearchFilesStartRequest",
    ) {
        return PipeEnvelope::error_response(request, responder, search_error(error));
    }
    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }
    match scheduler
        .start_search_files_job(params, request.clone(), event_sink)
        .await
    {
        Ok(started) => {
            encode_result::<search_ops::SearchJobStarted>(request, responder, Ok(started))
        }
        Err(error) => PipeEnvelope::error_response(request, responder, search_error(error)),
    }
}

async fn search_content_start(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
    event_sink: Option<Arc<dyn PipeEventSink>>,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<search_ops::SearchContentStartRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid search.content.start params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    if let Err(error) = search_ops::validate_contract_metadata(
        params.dto.as_deref(),
        params.version,
        "SearchContentStartRequest",
    ) {
        return PipeEnvelope::error_response(request, responder, search_error(error));
    }
    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }
    match scheduler
        .start_search_content_job(params, request.clone(), event_sink)
        .await
    {
        Ok(started) => {
            encode_result::<search_ops::SearchJobStarted>(request, responder, Ok(started))
        }
        Err(error) => PipeEnvelope::error_response(request, responder, search_error(error)),
    }
}

async fn search_job_cancel(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let params = match serde_json::from_value::<search_ops::SearchJobCancelRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid search.job.cancel params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };
    if let Err(error) = search_ops::validate_contract_metadata(
        params.dto.as_deref(),
        params.version,
        "SearchJobCancelRequest",
    ) {
        return PipeEnvelope::error_response(request, responder, search_error(error));
    }
    encode_result(
        request,
        responder,
        scheduler.cancel_search_job(params).await,
    )
}

fn encode_result<T>(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    result: Result<T, SearchProviderError>,
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
        Err(error) => PipeEnvelope::error_response(request, responder, search_error(error)),
    }
}

fn search_error(error: SearchProviderError) -> PipeError {
    match error {
        SearchProviderError::MissingRoot => PipeError::new(
            "search.missingRoot",
            "search request requires root or workspaceRoot",
            false,
            None,
        ),
        SearchProviderError::InvalidRoot(message) => {
            PipeError::new("search.invalidRoot", message, false, None)
        }
        SearchProviderError::InvalidPattern(message) => {
            PipeError::new("search.invalidPattern", message, false, None)
        }
        SearchProviderError::InvalidRegex(message) => {
            PipeError::new("search.invalidRegex", message, false, None)
        }
        SearchProviderError::InvalidRequest(message) => {
            PipeError::new("search.invalidRequest", message, false, None)
        }
        SearchProviderError::Cancelled => {
            PipeError::new("search.cancelled", "search job cancelled", false, None)
        }
        SearchProviderError::Io(message) => PipeError::new("search.io", message, true, None),
        SearchProviderError::Search(message) => {
            PipeError::new("search.failed", message, true, None)
        }
    }
}
