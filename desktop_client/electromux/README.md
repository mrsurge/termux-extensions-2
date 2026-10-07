# TE2 Electromux local-control backend foundation

Build with `node desktop_client/electromux/build.mjs` from the repository root.
Output: `desktop_client/electromux/dist/local-framework-backend.mjs`. The bundle
uses actual Desktop controller/config/roots modules, Node >=22.12, and no
Electron runtime dependency. This is TE2 consumer code, not generic Electromux.

The generic helper accepts a private native-owned `--backend-config` JSON file:
absolute `argv`, absolute existing `cwd`, optional environment overrides and
`stopTimeout` (up to 30 seconds). For this backend select 20 seconds so owned
framework shutdown can finish before helper escalation. Supply a consumer-specific
`TE2_CONFIG_HOME`, not another installation's Desktop configuration. Executable
declarations must never come from web pages.

Backend stdin/stdout use the helper's bounded big-endian length-prefixed JSON
request/reply protocol. Initial `ready` means the control backend accepts requests,
**not** that TE2 is running. Framework logs go to stderr; framework control remains
stdin plus inherited FD3, managed by the reused Desktop controller.

Supported methods: Desktop local config/get/save/state/start/stop/use,
`refresh_local_framework`, and consumer `shutdown`. Start acknowledges immediately;
the asynchronous operation runs `te2 --build-only` before the bounded control
hello/readiness window. After preparation, the controller rechecks the endpoint
to avoid claiming an externally started TE2. Errors appear in explicit state
reads and unsolicited `local-framework-state` events (`data` is the state DTO).
Events coalesce to the newest state under stdout backpressure. No automatic
mutation retry. Signals/EOF stop only owned children.

This is a tested foundation, **not yet wired into Android**. Native provisioning,
bridge authorization, persistent service ownership, native event consumption, endpoint sync,
ownership vocabulary/UI labels, and APK/helper publication are the next gate.
`ownership: "electron"` retains the current Desktop DTO until a host-neutral
contract is shared. Synthetic lifecycle tests now await state events without
polling. Preparation is opt-in and not enabled by Electron app assembly.

Generic helper event delivery requires `events: true` on the authenticated hello.
One backend reader separates integer-correlated replies from id-less events;
partial frames and replies retain deadlines. Each connection has one bounded
16-frame output queue. Slow clients disconnect rather than accumulating events
or blocking the backend reader. Detached events are discarded; reconnect must
read authoritative state. The existing Kotlin request-only client must be
upgraded before opting in. No page can choose backend argv through this protocol.

```sh
node desktop_client/electromux/build.mjs
node --test tests/electromux_local_backend.test.mjs
```
