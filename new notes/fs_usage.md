# Framework Shells (FWS) Usage — Repo Root Workflow

This repo uses the **installed** `framework-shells` Python package to manage long-running processes (“shells”) like app workers, LSP servers, and terminals. The authoritative code is the installed package (Termux site-packages), not any in-repo copies or old vendored snapshots.

## What “runtime” means (why shells are namespaced)

`framework_shells` stores shell metadata/logs under a runtime namespace:

- `repo_fingerprint` (repo-scoped) + `runtime_id` (secret-scoped)
- Storage layout:
  - `~/.cache/framework_shells/runtimes/<repo_fingerprint>/<runtime_id>/...`

In this repo, `scripts/run_framework.sh` sets the namespace by exporting:

- `FRAMEWORK_SHELLS_REPO_FINGERPRINT`
- `FRAMEWORK_SHELLS_SECRET`
- `FRAMEWORK_SHELLS_BASE_DIR` (defaults to `~/.cache/framework_shells` here)

### Secret file behavior (current setup)

After the recent reset, the repo is back to using a **secret file**:

- `scripts/run_framework.sh` computes `repo_fingerprint` from the repo root path (realpath → sha256 → first 16 chars).
- It then loads or creates:
  - `~/.cache/framework_shells/runtimes/<repo_fingerprint>/secret`
- It exports that value as `FRAMEWORK_SHELLS_SECRET`.

This secret is primarily about **runtime isolation** (so different checkouts / different secrets don’t see each other’s shells).

## Why `fws` “just works” for you right now (even with a secret file)

There are two common reasons:

1) **You run `fws` from the repo root**
- The CLI can compute the same `repo_fingerprint` from `cwd`.
- Then it can load the stored secret from:
  - `~/.cache/framework_shells/runtimes/<repo_fingerprint>/secret`
- Result: it targets the same runtime namespace as the running framework, without extra flags.

2) **You run `fws` in the same shell session that started the framework**
- `scripts/run_framework.sh` exported `FRAMEWORK_SHELLS_SECRET` into that shell.
- `fws` inherits it from the environment, so it matches the running framework runtime immediately.

If you run `fws` from a different directory *and* without the env vars, you may land in a different runtime (or fail if the secret can’t be discovered).

## How to view “backend loading” (live shells + logs)

### Option A: FWS dashboard (recommended)

With the framework running (default `http://127.0.0.1:8089`):

- Open the dashboard:
  - `/fws/`
- View logs for a specific shell:
  - `/fws/logs/<shell_id>`

This is the easiest way to see:
- which shells are starting/running/exited
- stderr/stdout output while they boot (LSP warmup is visible here)

### Option B: CLI from repo root

From the repo root:

```sh
fws list
fws list --stats
fws tree --depth 8
```

Equivalent (module form):

```sh
python -m framework_shells.cli.main list
python -m framework_shells.cli.main tree --depth 8
```

## Common CLI actions

### Spawn a one-off shell (no shellspec)

```sh
fws run --backend pipe --label lsp-test -- python -c "print('hello')"
fws run --backend pty  --label term -- bash -l -i
```

### Apply a shellspec YAML (orchestrator-style)

```sh
fws up path/to/shellspec.yaml
fws up --prune path/to/shellspec.yaml
```

### Terminate shells

```sh
fws down
```

### Attach (dtach only)

```sh
fws attach <shell_id_or_label>
```

## Where logs live on disk

Under the runtime directory:

- `~/.cache/framework_shells/runtimes/<repo_fingerprint>/<runtime_id>/logs/`
  - `<shell_id>.stdout.log`
  - `<shell_id>.stderr.log`

## Troubleshooting quick checks

### “I don’t see the shells I expect”

- Ensure you’re in the repo root (so fingerprint/secret auto-discovery matches):
  - `pwd`
- Check the env vars in your current shell:
  - `echo "$FRAMEWORK_SHELLS_REPO_FINGERPRINT"`
  - `echo "$FRAMEWORK_SHELLS_SECRET" | wc -c`
- Compare to the secret file:
  - `cat ~/.cache/framework_shells/runtimes/<repo_fingerprint>/secret`

### “403” or auth failures in UI/API

If auth is enabled, mutating endpoints require a token derived from `FRAMEWORK_SHELLS_SECRET`. A mismatch between the framework’s exported secret and your current shell environment will show up as 403s.

## Important note about “in-repo” copies

If you see directories like `.tmp_fws_repo*/framework_shells`, treat them as stale snapshots. The live behavior is coming from the installed module:

```sh
python -c "import framework_shells,framework_shells.auth as a; print(a.__file__)"
```

