# Minimal Security Manifesto (TE2 + framework_shells)

**Status:** Early-stage / dev-first. Security primitives exist, but are intentionally not enforced everywhere yet.

## 0) Threat model (what we are / are not protecting)

- Primary target today: **single-user, local device usage** (Termux-style), where the framework is accessed via localhost or an on-device browser.
- Not a target today: hardened multi-tenant hosting or hostile-network exposure.
- If you expose the framework to a network, assume you are exposing **process control / code execution** unless you enable strict auth and constrain the proxy surface.

## 1) Principles

1. **Correctness first:** process orchestration must be reliable (no leaks, predictable adoption, clean shutdown) before tightening controls.
2. **Capability-based access:** access should be granted via explicit capabilities (tokens/keys), not implicit trust.
3. **Namespace isolation ≠ authorization:** runtime isolation prevents accidental cross-talk; authorization prevents unwanted control.
4. **Narrow surface area:** proxy only what must be proxied; keep shell control as close to localhost as possible.
5. **Secure-by-optional-flag (for now):** enforce security when enabled, but keep the path to debugging clear.

## 2) The two-key model

### A) Namespace / isolation secret

- `FRAMEWORK_SHELLS_SECRET` derives a `runtime_id` (namespace) and isolates:
  - metadata, logs, dtach sockets
  - adoption visibility across runs
  - multiple frameworks/clones on the same device

This is primarily about **isolation and ownership**.

### B) Authorization capability

- A derived token (e.g. HMAC(secret, "api")) can gate mutating operations.
- TE2 may optionally use this to refuse remote access or to require an "unlock" step.

This is primarily about **permissions and remote safety**.

## 3) TE2 “simple security” path (intended)

- First-run: prompt user to set a password.
- Store a verifier (not the password) derived using the framework secret.
- On unlock, issue a session cookie / short-lived token for subsequent requests.
- Optionally cache client state for UX, but server remains the source of truth.

## 4) Guidance for “prime time”

When the framework is ready for broader exposure:

- Make non-local binding (0.0.0.0) an explicit opt-in.
- Turn on auth by default for mutating endpoints and WebSockets.
- Add origin/CSRF protections if cookies are used.
- Add rate limits and explicit allowlists for spawned commands where appropriate.

## 5) Non-goals (at least for now)

- Perfect, formal, multi-tenant sandboxing.
- Treating TE2 as an internet-facing service by default.

---

This file is intentionally minimal: it describes the security direction without blocking early-stage development.