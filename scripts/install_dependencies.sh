#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQ_DIR="$SCRIPT_DIR/requirements"

PLATFORM=""
declare -a SOURCES=()

usage() {
  cat <<'EOF'
Usage:
  ./scripts/install_dependencies.sh [--platform termux|ubuntu] [--source apt|tur|npm]...

Defaults:
  termux -> apt, tur, npm
  ubuntu -> apt, npm

Notes:
  - Package files live under scripts/requirements/.
  - Blank lines and # comments are ignored.
  - This script installs non-Python external dependencies only.
EOF
}

detect_platform() {
  if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux/files/usr" ]; then
    echo "termux"
    return
  fi

  if [ -r /etc/os-release ]; then
    case "$(tr '[:upper:]' '[:lower:]' < /etc/os-release)" in
      *ubuntu*|*debian*)
        echo "ubuntu"
        return
        ;;
    esac
  fi

  echo "Unable to detect platform. Use --platform termux or --platform ubuntu." >&2
  exit 1
}

read_packages() {
  local file="$1"
  [ -f "$file" ] || return 0
  sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$file"
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_termux_apt() {
  mapfile -t packages < <(read_packages "$REQ_DIR/termux/apt.txt")
  [ "${#packages[@]}" -gt 0 ] || return 0
  pkg update -y
  pkg install -y "${packages[@]}"
}

install_termux_tur() {
  mapfile -t packages < <(read_packages "$REQ_DIR/termux/tur.txt")
  [ "${#packages[@]}" -gt 0 ] || return 0
  pkg install -y tur-repo
  pkg update -y
  pkg install -y "${packages[@]}"
}

install_termux_npm() {
  mapfile -t packages < <(read_packages "$REQ_DIR/termux/npm.txt")
  [ "${#packages[@]}" -gt 0 ] || return 0
  npm install -g "${packages[@]}"
}

install_ubuntu_apt() {
  mapfile -t packages < <(read_packages "$REQ_DIR/ubuntu/apt.txt")
  [ "${#packages[@]}" -gt 0 ] || return 0
  run_root apt-get update
  run_root apt-get install -y "${packages[@]}"
}

install_ubuntu_npm() {
  mapfile -t packages < <(read_packages "$REQ_DIR/ubuntu/npm.txt")
  [ "${#packages[@]}" -gt 0 ] || return 0
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required for ubuntu npm sources. Install ubuntu apt requirements first." >&2
    exit 1
  fi
  run_root npm install -g "${packages[@]}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --platform)
        [ "$#" -ge 2 ] || { echo "--platform requires a value" >&2; exit 1; }
        PLATFORM="$2"
        shift 2
        ;;
      --source)
        [ "$#" -ge 2 ] || { echo "--source requires a value" >&2; exit 1; }
        SOURCES+=("$2")
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  if [ -z "$PLATFORM" ]; then
    PLATFORM="$(detect_platform)"
  fi

  if [ "${#SOURCES[@]}" -eq 0 ]; then
    if [ "$PLATFORM" = "termux" ]; then
      SOURCES=(apt tur npm)
    elif [ "$PLATFORM" = "ubuntu" ]; then
      SOURCES=(apt npm)
    else
      echo "Unsupported platform: $PLATFORM" >&2
      exit 1
    fi
  fi

  case "$PLATFORM" in
    termux)
      for source in "${SOURCES[@]}"; do
        case "$source" in
          apt) install_termux_apt ;;
          tur) install_termux_tur ;;
          npm) install_termux_npm ;;
          *)
            echo "Unsupported termux source: $source" >&2
            exit 1
            ;;
        esac
      done
      ;;
    ubuntu)
      for source in "${SOURCES[@]}"; do
        case "$source" in
          apt) install_ubuntu_apt ;;
          npm) install_ubuntu_npm ;;
          *)
            echo "Unsupported ubuntu source: $source" >&2
            exit 1
            ;;
        esac
      done
      ;;
    *)
      echo "Unsupported platform: $PLATFORM" >&2
      exit 1
      ;;
  esac
}

main "$@"
