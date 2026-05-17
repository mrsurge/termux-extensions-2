# Proxy Shell Wrapper Template

This is a first-party template for onboarding non-native worker apps through the shared `proxy_shell` engine.

Copy this directory to `app/apps/<your_app_id>/` and then update:
- `manifest.json` (`id`, `name`, `description`, icon, and `proxy_shell` paths),
- `shellspec/app_worker.yaml` (worker command + readiness),
- optional UI styling/text in `template.html`.

The `main.js` file is app-id agnostic and resolves `app_id` from `/app/<app_id>` URL path at runtime.

## Expected Runtime

- Proxy metadata endpoint:
  - `/api/apps/{app_id}/proxy_shell`
- Proxied start URL and health URL are read from that endpoint.

No per-endpoint proxy module is required.
