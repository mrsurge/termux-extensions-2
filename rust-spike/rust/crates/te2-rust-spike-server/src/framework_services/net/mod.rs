mod bookmark_net_ops;
mod fs_net_ops;
mod git_net_ops;
mod run_target_net_ops;
mod settings_net_ops;
mod state_net_ops;

use axum::Router;

pub(super) fn router() -> Router<crate::AppState> {
    Router::new()
        .merge(fs_net_ops::router())
        .merge(git_net_ops::router())
        .merge(run_target_net_ops::router())
        .merge(bookmark_net_ops::router())
        .merge(settings_net_ops::router())
        .merge(state_net_ops::router())
}
