#!/usr/bin/env bash
set -euo pipefail

# Simple bootstrap helper for the termux-extensions-2 framework.
# Installs Termux packages, Python dependencies, and wires the framework scripts.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
BIN_DIR="$HOME/bin"
REQUIREMENTS_FILE="$PROJECT_ROOT/requirements.txt"
INIT_SCRIPT="$SCRIPTS_DIR/init.sh"
RUN_SCRIPT="$SCRIPTS_DIR/run_framework.sh"

check_shell() {
  if [[ -z "${BASH_VERSION:-}" ]];
  then
    read -r -p "This script expects to run under bash. Switch to bash and continue? [y/N] " reply
    case "$reply" in
      [yY][eE][sS]|[yY]) ;;
      *)
        echo "Please restart Termux with bash and re-run this script." >&2
        exit 1
        ;;
    esac
  fi
}

install_termux_packages() {
  echo "[bootstrap] Updating pkg repositories…"
  pkg update -y
  echo "[bootstrap] Installing base packages…"
  pkg install -y \
    bash \
    python \
    python-pip \
    clang \
    git \
    make \
    pkg-config \
    libffi \
    openssl \
    llama-cpp

  read -r -p "Install optional llama-cpp OpenCL backend (requires Snapdragon/OpenCL)? [y/N] " reply
  case "$reply" in
    [yY][eE][sS]|[yY])
      pkg install -y llama-cpp-backend-opencl
      ;;
    *)
      echo "[bootstrap] Skipping OpenCL backend." ;;
  esac
}

install_python_requirements() {
  echo "[bootstrap] Installing Python requirements…"
  pip install --upgrade pip
  pip install --user -r "$REQUIREMENTS_FILE"
}

ensure_bashrc_hook() {
  local hook="source $INIT_SCRIPT"
  if [[ ! -f "$HOME/.bashrc" ]]; then
    echo "[bootstrap] Creating ~/.bashrc"
    touch "$HOME/.bashrc"
  fi
  if ! grep -Fq "$hook" "$HOME/.bashrc"; then
    echo "[bootstrap] Adding init.sh sourcing to ~/.bashrc"
    printf '\n# Termux extensions init\n%s\n' "$hook" >> "$HOME/.bashrc"
  fi
}

link_run_script() {
  mkdir -p "$BIN_DIR"
  chmod +x "$RUN_SCRIPT"
  local target="$BIN_DIR/run_framework.sh"
  if [[ -L "$target" || -e "$target" ]]; then
    if [[ $(readlink -f "$target") != "$RUN_SCRIPT" ]]; then
      echo "[bootstrap] Replacing existing $target"
      rm -f "$target"
    fi
  fi
  ln -sf "$RUN_SCRIPT" "$target"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "[bootstrap] Adding $BIN_DIR to PATH in ~/.bashrc"
    printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$HOME/.bashrc"
  fi
}

main() {
  check_shell
  install_termux_packages
  install_python_requirements
  ensure_bashrc_hook
  link_run_script

  echo
  echo "Bootstrap complete. Open a new Termux session (or source ~/.bashrc) then run:\n  run_framework.sh"
}

main "$@"
