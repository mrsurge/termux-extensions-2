# Electromux outstanding issues

## Dead helper socket hides the launcher (2026-10-07)

Confirmed on Razr without reload, storage clearing or process restart: native
launcher loads `/electromux-shell/index.html`; saved helper session
`98d5f49300b5` has `attempted=true` and a retained `host.sock`. No Python helper
or Node actor is running, and a read-only AF_UNIX connect returns errno 111.
Native startup exposes Connection refused; ConsumerPageProtocol deliberately
masks its exception as Consumer request failed. The local-framework extension
starts hidden and leaves it hidden when its initial state read fails. This
incident is helper lifecycle failure, not evidence of editor OTA replacement.
The exact cause of helper process death has not been established.

Approved source fix: generic helper holds a lifetime nonblocking file lock;
opt-in stale recovery refuses live/uncertain endpoints and non-socket paths,
reclaiming only refused/missing sockets under that lock. Native client attempts
bounded recovery only for connect refusal, before authentication/requests, never
replaying a mutation. Fresh helper instance identity distinguishes a new actor
from an uncertain stopped actor in the same helper. Launcher state failure shows
a visible error card with Reconnect, which reads state and does not invoke Start.
Missing endpoint with a previously attempted launch remains fail-closed rather
than treating a missing file as proof of a safe relaunch.

Source validation passes: 15 generic helper tests including SIGKILL/socket
recovery without backend start and live-owner protection, 5 browser tests and
Termux Kotlin/JVM compilation/tests. APK installation preserved the failing
storage and user live acceptance passed on 2026-10-07. Do not clear data as a fix.

## TE2 Termux settings and installation follow-up (2026-10-07)

Connection layout, native one-time bookmark seed and Android keep-alive/settings
controls are source-implemented; source checks pass, APK/live validation remains
pending. The implementation status in PLAN/TRACKER supersedes the proposal list
below. Remote clipboard/run-profile validation and installer work remain open.

## Framework-independent Android debug tap

Provide opt-in ADB-accessible CDP or console evaluation without requiring TE2 to
run. Cefrium already includes CDP machinery; investigate native enable/discovery
and lifecycle first, retaining exact target selection and bounded commands.
Plan only for now; no debug policy or device changes in the settings slice.

## Original settings/install scope

The higher-priority helper bug is live accepted. Resume with connection/Android
settings first, installer integration second; obtain concrete edit-scope approval.
No implementation approval is implied by this list.

1. **Framework URL field visibility.** User reports the text box missing. The
   packaged Desktop-reused `settings.html` still declares `#framework-host` and
   `#framework-port`; inspect the actual mobile layout before assigning a cause.
2. **Framework bookmarks.** The consumer adapter already maps bookmark list,
   save and delete to the existing Android gateway/native persistence. Verify
   connecting a selected bookmark end to end. Propose a one-time localhost
   bookmark (`127.0.0.1:8089`), without repeatedly recreating a deleted bookmark
   or overwriting existing/manual endpoints.
3. **Remote loopback routing.** TE2 Termux reuses PersistentNetworkService and
   AndroidFrameworkRelay; framework-matching URLs rewrite to the loopback browser
   origin. Verify remote app, clipboard/security and run-profile routes explicitly;
   shared source alone does not prove every runtime capability. Do not introduce
   a second proxy or disable browser security as a substitute.
4. **Android settings parity.** Add consumer UI for existing persistent-network
   notification/keep-alive settings, permission status and battery-policy action.
   Reuse native service/permission handling and refreshed status after returning
   from system Settings. Explain wake-lock/power behavior accurately; do not
   invent a runtime wake-lock permission or duplicate the Android policy owner.
5. **Missing-framework install flow.** When Termux is present, no executable is
   detected, and neither a manual command nor venv is configured, reuse the
   framework status card with an Install action and progress stdout viewport.
   Explain that installation is available in Settings. Explicit manual config
   suppresses this UI even if invalid; show its configuration error instead.
   Invoke the standard curl-friendly Termux installer, independently versioned
   from the APK/wheel. Never auto-install on entry or from remote page intent.
   Use bounded progress, one owned child, explicit confirmation, cancellation,
   exit/error reporting and post-success executable rediscovery. Cancellation
   must not stop an unrelated framework or imply rollback completed.
6. **Optional installer signals.** Installer currently has no `--stdio` mode.
   Plan an opt-in versioned control channel separate from human stdout, retaining
   normal shell use and authoritative exit status. Account for shell bootstrap
   downloads before Python starts; structured progress cannot be assumed for
   older published scripts. A newer installer source is not live until published.

Validation after renewed approval: browser/adapter/native regressions, mobile
layout, bookmark persistence/connect/delete, default seeding once, permission
return refresh, installer success/failure/cancel and manual-config exclusion.
Actual installer execution, APK assembly/install and publication need their own
approval. No shared-framework restart is part of this proposal.
