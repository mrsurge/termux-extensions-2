# Dependency reduction tracker

- [x] Scope approved: investigate FastAPI/FastMCP, console/MCP ownership and alternatives.
- [x] Inventory supported app entrypoints/ASGI contracts and frontend typing state.
- [x] Trace Pydantic/cryptography dependency paths in installed metadata.
- [x] Distinguish ALS-RS native runtime from stale FastAPI requirement.
- [x] Include maintainer-owned Framework-Shells in coordinated ASGI migration plan.
- [x] Identify ALS Python SDK MCP/KB server as separate transitive dependency owner.
- [x] Compare Rust MCP candidates and legacy SSE transport caveat.
- [x] Record renamed-wheel alternatives and deferred shared-library/pipe ideas.
- [ ] Approve first concrete implementation slice.
- [ ] Terminal migration/type/lifecycle/transport regressions.
- [ ] Other app/frontend/template migrations.
- [ ] Framework-Shells coordinated migration and updated release metadata.
- [ ] Runtime bridge/console typed ASGI migration.
- [ ] Rust MCP POC and transport/client/schema acceptance.
- [ ] ALS dependency/MCP work separately scoped and validated.
- [ ] Clean target dependency-resolution and installed release acceptance.

Evidence: read-only source/installed metadata inspection only. No runtime imports,
package uninstall/install, framework/app/harness restart, Rust builds or dependency
changes were performed. Local TE2 installed metadata is older than checkout source;
requirements/source and release metadata remain authority for later resolution.
No nested-repository source was edited. Earlier uncommitted source/asset/build
work and unrelated user files remain preserved. No performance/size win is claimed
before measurement. Web references and compatibility details are in PLAN.md.
