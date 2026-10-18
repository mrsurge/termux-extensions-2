# TE2 MCP — native framework service

The Python MCP server/client implementation has been removed. TE2 does not import,
serve or fall back to FastMCP. The Python runtime bridge retains only its existing
console relay and typed private owner APIs.

The Rust framework serves the complete 24-tool catalog at `/te2_mcp_http` using
rmcp Streamable HTTP, including SSE response streams. Configure clients as HTTP/
Streamable HTTP, not the retired two-endpoint SSE transport. `/te2_mcp` and its
old subpaths return HTTP 410 with the new endpoint; they never redirect or replay
requests. A framework built without native-mcp cannot fall back to Python MCP.

Native status reports `framework_owned_native`. Tool handlers use the actual
framework manager/services, exact worker pipes and capability-protected Python
console/scaffold/log-analysis owners, not duplicate runtime state. Names, schemas,
credentials, exact-worker targeting and mutation no-retry contracts remain.

Source and transport tests: `framework/rust/crates/te2-server/src/native_mcp.rs`,
`framework/mcp_probe/README.md` and `framework/mcp_probe/TOOL_OWNERS.md`.
Activation/acceptance gates: `docs/apps/dependency_trim/PLAN.md` and `TRACKER.md`.

The captured Python tool descriptors and console golden fixtures are development
parity baselines, not a retained Python server. The test-only console reference
lives under `framework/mcp_probe/`, outside the Python app runtime.

Dependency removal here does not assert removal of ALS/FWS transitive packages or
rewrite already published wheels/release locks. Coordinate those dependency
updates and regenerate the target lock/wheelhouse before release validation.
