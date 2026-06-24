use serde_json::{Value, json};

use super::protocol::{PipeEnvelope, PipeError, PipeIdentity};
use crate::framework_services::{
    fs_ops::{BrowseError, FsListDirectoryRequest},
    scheduler::FrameworkServiceScheduler,
};

pub(super) async fn dispatch_fs_request(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> Option<PipeEnvelope> {
    match request.method.as_deref() {
        Some("fs.listDirectory") => Some(list_directory(request, responder, scheduler).await),
        _ => None,
    }
}

async fn list_directory(
    request: &PipeEnvelope,
    responder: &PipeIdentity,
    scheduler: &FrameworkServiceScheduler,
) -> PipeEnvelope {
    let params = request.params.clone().unwrap_or_else(|| json!({}));
    let mut params = match serde_json::from_value::<FsListDirectoryRequest>(params) {
        Ok(params) => params,
        Err(error) => {
            return PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new(
                    "protocol.invalidParams",
                    format!("invalid fs.listDirectory params: {error}"),
                    false,
                    None,
                ),
            );
        }
    };

    if params.root.is_none() {
        params.root.clone_from(&request.workspace_root);
    }
    if params.project_generation.is_none() {
        params.project_generation = request.project_generation;
    }

    match scheduler.fs_list_directory(params).await {
        Ok(listing) => match serde_json::to_value(listing) {
            Ok(result) => PipeEnvelope::success_response(request, responder, result),
            Err(error) => PipeEnvelope::error_response(
                request,
                responder,
                PipeError::new("protocol.encodeFailed", error.to_string(), false, None),
            ),
        },
        Err(error) => PipeEnvelope::error_response(request, responder, fs_error(error)),
    }
}

fn fs_error(error: BrowseError) -> PipeError {
    match error {
        BrowseError::AccessDenied => PipeError::new(
            "fs.outsideRoot",
            "Path is outside the requested root",
            false,
            None,
        ),
        BrowseError::UnsupportedSudo => PipeError::new(
            "fs.unsupportedSudo",
            "sudo browse is not implemented in the Rust spike",
            false,
            None,
        ),
        BrowseError::Io(error) => match error.kind() {
            std::io::ErrorKind::NotFound => PipeError::new(
                "fs.notFound",
                "Path does not exist",
                false,
                Some(io_details(&error)),
            ),
            std::io::ErrorKind::PermissionDenied => PipeError::new(
                "fs.permissionDenied",
                error.to_string(),
                false,
                Some(io_details(&error)),
            ),
            _ => PipeError::new("fs.io", error.to_string(), true, Some(io_details(&error))),
        },
    }
}

fn io_details(error: &std::io::Error) -> Value {
    json!({
        "kind": format!("{:?}", error.kind()),
    })
}
