# IPC Documentation Follow-Ups

This note tracks documentation tasks required after introducing the IPC microservice.

## Sections to Add or Update

- **Synchronous IPC Overview** — explain purpose, architecture, and relation to the ASGI framework.
- **Topology Diagram** — show supervisor + ASGI host + IPC service, including message flow.
- **Startup Lifecycle** — document how `scripts/run_framework.sh` launches the IPC server and how shutdown is coordinated via the supervisor.
- **Security Notes** — describe token usage (`X-Framework-Key`) and future auth plans once hardened.

## API Reference Updates

- Document `/health`, `/messages`, `/actions/shutdown`, `/actions/agent-spawn`, and `/stream` endpoints.
- Provide request/response examples, expected headers, and error payloads.
- Map IPC commands to existing framework actions (e.g., shutdown, Codex spawn).

## Operational Guidance

- Add runbook steps for monitoring IPC logs (console prefix `[ipc]`), log rotation, and SSE troubleshooting.
- Capture instructions for restarting only the IPC service and handling port conflicts.
- Note metrics/observability hooks to build later (spawn counts, latencies).

## Migration Checklist

- Update onboarding docs to mention `app/ipc/` directory and control helpers.
- Add test coverage expectations (unit for IPC handlers, smoke tests for integration with framework endpoints).
- Ensure deployment scripts manage the IPC PID and perform graceful shutdown.

This file should be merged into the appropriate docs once the IPC layer is finalized.
