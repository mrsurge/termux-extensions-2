pub(crate) mod bookmark_ops;
pub(crate) mod common;
pub(crate) mod fs_ops;
pub(crate) mod git_ops;
mod net;
pub(crate) mod pipe;
pub(crate) mod run_target_ops;
pub(crate) mod scheduler;
pub(crate) mod search_ops;
pub(crate) mod search_changes;
pub(crate) mod settings_ops;
pub(crate) mod state_ops;
pub(crate) mod text_edit_ops;
pub(crate) mod text_edit_disk;
pub(crate) mod hunk_edits;

use axum::Router;

pub(crate) fn router() -> Router<crate::AppState> {
    net::router()
}
