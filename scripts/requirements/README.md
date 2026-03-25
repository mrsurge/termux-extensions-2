This directory is the source of truth for non-Python external dependencies.

Conventions:
- One package per line.
- Blank lines and `#` comments are ignored.
- Files are split by platform and package source.

Current layout:
- `termux/apt.txt`: official Termux repository packages
- `termux/tur.txt`: Termux packages that require `tur-repo`
- `termux/npm.txt`: global npm packages for Termux, if any
- `ubuntu/apt.txt`: Debian/Ubuntu base system packages
- `ubuntu/npm.txt`: global npm packages for Debian/Ubuntu

Use `scripts/install_dependencies.sh` to install these in the intended order.
