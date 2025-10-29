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

The repository ships with an installation helper (`scripts/bootstrap_termux.sh`, see below) that automates package and Python dependency installation. Run it directly:

```bash
./scripts/bootstrap_termux.sh
```

The script performs the following:

1. Confirms you are running `bash` (the framework assumes shells source `.bashrc`).
2. Installs Termux packages: `python`, `python-pip`, `clang`, `git`, `make`, `pkg-config`, `libffi`, `openssl`, `llama-cpp`, and (optionally) `llama-cpp-backend-opencl` for Snapdragon/OpenCL acceleration.
3. Installs Python requirements via `pip install -r requirements.txt` (inside a framework-friendly `~/.local` environment).
4. Ensures `scripts/init.sh` is sourced from `~/.bashrc` so interactive shells show up in the framework UI.
5. Adds `scripts/` to your PATH and symlinks `start-te` (wrapper for `run_framework.sh`) into `~/bin/`.
6. Ensures `scripts/run_framework.sh` is executable.

> **Manual alternative:** if you prefer to run commands yourself, follow the same steps manually: `pkg install` dependencies, run `pip install -r requirements.txt`, append `source ~/termux-extensions-2/scripts/init.sh` to `~/.bashrc`, and add `~/termux-extensions-2/scripts` to your PATH.

## 3. Launch the framework

After the script completes, open a new Termux session (so `.bashrc` is reloaded) and start the supervisor:

```bash
start-te
```

This runs `python -m app.supervisor`, loads extensions/apps, and exposes the framework at `http://localhost:8080`. Access it locally via a browser (e.g. `http://127.0.0.1:8080`) or over LAN if you bind externally.

## 4. Post-install checklist

- Confirm the **Sessions & Shortcuts** extension lists your active shell.
- Open the **Termux-LM** app from the launcher; model cards should appear from cache (if any) or show the empty state.
- Tail logs for llama.cpp shells:

  ```bash
  tail -f ~/.cache/termux_lm/stream.log
  ```

- To stop the framework, press `Ctrl+C` in the shell running `start-te`; the supervisor will shut down all framework shells automatically.

## Notes

- The framework expects Termux’s default file hierarchy. If you use external storage, update model paths accordingly when configuring Termux-LM cards.
- For remote models, ensure outbound network access is allowed (Termux typically permits this by default).
- When installing additional Termux packages for extensions, prefer adding them to the bootstrap script to keep new devices reproducible.

Refer back to `WARP.md` for deeper architecture and operational details once the environment is up and running.
