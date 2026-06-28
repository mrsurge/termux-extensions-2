pub(crate) mod bookmark_ops;
pub(crate) mod common;
pub(crate) mod fs_ops;
pub(crate) mod git_ops;
mod net;
pub(crate) mod pipe;
pub(crate) mod scheduler;
pub(crate) mod search_ops;
pub(crate) mod settings_ops;
pub(crate) mod state_ops;

use axum::Router;

pub(crate) fn router() -> Router<crate::AppState> {
    net::router()
}
