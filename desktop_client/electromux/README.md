# TE2 Electromux local-control backend foundation

Build with `node desktop_client/electromux/build.mjs` from the repository root.
Output: `desktop_client/electromux/dist/local-framework-backend.mjs`. The bundle
uses actual Desktop controller/config/roots modules, Node >=22.12, and no
Electron runtime dependency. This is TE2 consumer code, not generic Electromux.

The generic helper accepts a private native-owned `--backend-config` JSON file:
absolute `argv`, absolute existing `cwd`, optional environment overrides and
`stopTimeout` (up to 30 seconds). For this backend select 20 seconds so owned
framework shutdown can finish before helper escalation. Supply a consumer-specific
`TE2_ELECTROMUX_CONFIG_HOME` for the launcher configuration only, not another
installation's Desktop configuration. It does not change the framework child's
`TE2_CONFIG_HOME`. Executable
declarations must never come from web pages.

Backend stdin/stdout use the helper's bounded big-endian length-prefixed JSON
request/reply protocol. Initial `ready` means the control backend accepts requests,
**not** that TE2 is running. Framework logs go to stderr; framework control remains
stdin plus inherited FD3, managed by the reused Desktop controller.

Supported methods: Desktop local config/get/save/state/start/stop/use,
`refresh_local_framework`, and consumer `shutdown`. Start acknowledges immediately;
the asynchronous operation launches `te2` normally once. Bootstrap itself builds
editable/source installations and uses binaries for release installations. The
mobile actor waits indefinitely for existing FD3 hello and server readiness,
without a separate `--build-only` process or parsing output as readiness. Errors appear in explicit state
reads and unsolicited `local-framework-state` events (`data` is the state DTO).
Events coalesce to the newest state under stdout backpressure. No automatic
mutation retry. During startup, bounded `startupOutput` carries the latest stdout
line and `cancellableStartup` enables Cancel through the existing Stop method.
Cancel SIGTERMs only the owned process group; late readiness cannot select it.
Stderr stays diagnostic, and failure/exit still ends startup. Signals/EOF stop
only owned children. No released bootstrap changes are required.

The TE2 Termux source adapter now wires native provisioning, exact launcher/settings
authorization, PersistentNetworkService ownership, document-fenced events and
selected-endpoint synchronization. APK assembly/install and physical acceptance
remain separate gates; no local device launch is claimed from these tests.
`ownership: "electron"` retains the current Desktop DTO until a host-neutral
contract is shared. Synthetic lifecycle tests now await state events without
polling. Indefinite startup is opt-in only for the mobile actor; Electron keeps
its existing deadlines until its separately deferred wheel update.

Generic helper event delivery requires `events: true` on the authenticated hello.
One backend reader separates integer-correlated replies from id-less events;
partial frames and replies retain deadlines. Each connection has one bounded
16-frame output queue. Slow clients disconnect rather than accumulating events
or blocking the backend reader. Detached events are discarded; reconnect must
read authoritative state. TE2 Termux uses the pinned host's single-reader native
client before opting in. No page can choose backend argv through this protocol.

`set_selected_framework` is native-consumer-only and validates a plain HTTP(S)
origin; it updates observation without advancing `selectionRevision`. Explicit
Start/Use increments that revision. The Android adapter fences that intent against
the service's current endpoint and projects actual native selection back to pages.

```sh
node desktop_client/electromux/build.mjs
node --test tests/electromux_local_backend.test.mjs
```
