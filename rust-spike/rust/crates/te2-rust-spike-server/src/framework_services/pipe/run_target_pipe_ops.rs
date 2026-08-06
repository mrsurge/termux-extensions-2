use serde::Serialize;
use serde_json::json;

use super::protocol::{PipeEnvelope, PipeError, PipeIdentity};
use crate::framework_services::{
    run_target_ops::{
        RunTargetRegisterRequest, RunTargetReleaseRequest, RunTargetRouteSetRegisterRequest,
    },
    scheduler::FrameworkServiceScheduler,
};

pub(super) async fn dispatch_run_target_request(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> Option<PipeEnvelope> {
    match request.method.as_deref()? {
        "runTarget.route.register" => Some(register(request, responder, scheduler).await),
        "runTarget.routes.register" => Some(register_set(request, responder, scheduler).await),
        "runTarget.routes.list" => Some(list(request, responder, scheduler).await),
        "runTarget.route.release" => Some(release(request, responder, scheduler).await),
        _ => None,
    }
}

async fn list(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let value = scheduler.run_targets().list().await;
    match serde_json::to_value(value) {
        Ok(value) => PipeEnvelope::success_response(request, responder, value),
        Err(error) => PipeEnvelope::error_response(
            request,
            responder,
            PipeError::new("runTarget.internalError", error.to_string(), false, None),
        ),
    }
}

async fn register_set(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let params = match serde_json::from_value::<RunTargetRouteSetRegisterRequest>(params) {
        Ok(params) => params,
        Err(error) => return invalid_params(request, responder, "routes.register", error),
    };
    encode_result(
        request,
        responder,
        scheduler.run_targets().register_set(params).await,
    )
}

async fn register(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let params = match serde_json::from_value::<RunTargetRegisterRequest>(params) {
        Ok(params) => params,
        Err(error) => return invalid_params(request, responder, "route.register", error),
    };
    encode_result(
        request,
        responder,
        scheduler.run_targets().register(params).await,
    )
}

async fn release(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let params = match serde_json::from_value::<RunTargetReleaseRequest>(params) {
        Ok(params) => params,
        Err(error) => return invalid_params(request, responder, "route.release", error),
    };
    encode_result(
        request,
        responder,
        scheduler.run_targets().release(params).await,
    )
}

fn encode_result<T: Serialize>(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    result: Result<T, String>,
) -> PipeEnvelope {
    match result.and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())) {
        Ok(value) => PipeEnvelope::success_response(request, responder, value),
        Err(error) => PipeEnvelope::error_response(
            request,
            responder,
            PipeError::new("runTarget.invalidRequest", error, false, None),
        ),
    }
}

fn invalid_params(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    operation: &str,
    error: serde_json::Error,
) -> PipeEnvelope {
    PipeEnvelope::error_response(
        request,
        responder,
        PipeError::new(
            "protocol.invalidParams",
            format!("invalid runTarget.{operation} params: {error}"),
            false,
            None,
        ),
    )
}
