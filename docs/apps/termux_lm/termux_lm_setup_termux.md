# Termux Extensions 2 · Termux Setup Guide

This guide covers the quickest path to clone and run the `termux-extensions-2` framework (and the Termux-LM app) on a fresh Termux install. It distils the project guidance in `WARP.md` into a concrete Termux workflow.

## 1. Clone the repository

```bash
pkg update
pkg install git
git clone https://github.com/mrsurge/termux-extensions-2.git
cd termux-extensions-2
```

## 2. Install dependencies

Install the external non-Python dependencies first:

```bash
./scripts/install_dependencies.sh --platform termux
```

Then install the Python package in editable mode:

```bash
python -m pip install -e .
```

The dependency installer performs the following:

1. Installs official Termux `apt` packages from `scripts/requirements/termux/apt.txt`.
2. Enables `tur-repo` and installs `tur` packages from `scripts/requirements/termux/tur.txt`.
3. Installs any Termux npm fallbacks from `scripts/requirements/termux/npm.txt` if that file is populated.

> **Manual alternative:** if you prefer to run commands yourself, use the package lists under `scripts/requirements/termux/`, then run `python -m pip install -e .`.

## 3. Launch the framework

After installation completes, start the framework with the packaged entrypoint:

```bash
te2
```

This launches the framework, loads extensions/apps, and exposes it at the configured local port. Access it locally via a browser (for example `http://127.0.0.1:8089` if you use the default current port).

## 4. Post-install checklist

- Confirm the **Sessions & Shortcuts** extension lists your active shell.
- Open the **Termux-LM** app from the launcher; model cards should appear from cache (if any) or show the empty state.
- Tail logs for llama.cpp shells:

  ```bash
  tail -f ~/.cache/termux_lm/stream.log
  ```

- To stop the framework, press `Ctrl+C` in the shell running `te2`; the supervisor will shut down framework shells automatically.

## Notes

- The framework expects Termux’s default file hierarchy. If you use external storage, update model paths accordingly when configuring Termux-LM cards.
- For remote models, ensure outbound network access is allowed (Termux typically permits this by default).
- When installing additional Termux packages for extensions, prefer updating the package lists under `scripts/requirements/termux/` so new devices stay reproducible.

Refer back to `WARP.md` for deeper architecture and operational details once the environment is up and running.
