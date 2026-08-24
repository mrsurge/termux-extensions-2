#!/usr/bin/env bash
set -euo pipefail

: "${TE2_RELEASE_COMMIT:?TE2_RELEASE_COMMIT is required}"
: "${TE2_RELEASE_TAG:?TE2_RELEASE_TAG is required}"
: "${TE2_RELEASE_PLATFORM_TAG:?TE2_RELEASE_PLATFORM_TAG is required}"
: "${TE2_RELEASE_MINIMUM_GLIBC:?TE2_RELEASE_MINIMUM_GLIBC is required}"
: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH is required}"
: "${TE2_RELEASE_BUILDER_IMAGE:?TE2_RELEASE_BUILDER_IMAGE is required}"

export CARGO_HOME=/work/cargo-home
export CARGO_TARGET_DIR=/work/cargo-target
export HOME=/work/home
export RUSTUP_HOME=/opt/rustup

rm -rf /work/source /work/package-dist /work/repaired
mkdir -p /work/source /work/package-dist /work/repaired /work/home /output
cp -a /input/. /work/source/

cd /work/source
cargo build \
  --locked \
  --release \
  --manifest-path framework/rust/Cargo.toml \
  --package te2-server \
  --features ferrous-framework-native,release-vendored-tls

server="${CARGO_TARGET_DIR}/release/te2-server"
test -x "${server}"
strip --strip-unneeded "${server}"

env \
  -u TE2_RELEASE_SERVER_BIN \
  -u TE2_RELEASE_PLATFORM_TAG \
  -u TE2_RELEASE_MINIMUM_GLIBC \
  -u TE2_RELEASE_TAG \
  -u TE2_RELEASE_COMMIT \
  python -m build --sdist --no-isolation --outdir /work/package-dist .

export TE2_RELEASE_SERVER_BIN="${server}"
python -m build --wheel --no-isolation --outdir /work/package-dist .

preliminary_wheel="$(find /work/package-dist -maxdepth 1 -type f -name '*.whl' -print -quit)"
sdist="$(find /work/package-dist -maxdepth 1 -type f -name '*.tar.gz' -print -quit)"
test -n "${preliminary_wheel}"
test -n "${sdist}"

auditwheel repair \
  --plat "${TE2_RELEASE_PLATFORM_TAG}" \
  --wheel-dir /work/repaired \
  "${preliminary_wheel}"
wheel="$(find /work/repaired -maxdepth 1 -type f -name '*.whl' -print -quit)"
test -n "${wheel}"

auditwheel show "${wheel}" > /work/auditwheel-show.txt
ldd "${server}" > /work/server-ldd.txt

python /usr/local/libexec/te2-validate-linux-wheel \
  --wheel "${wheel}" \
  --sdist "${sdist}" \
  --server "${server}" \
  --auditwheel-report /work/auditwheel-show.txt \
  --ldd-report /work/server-ldd.txt \
  --output /output \
  --commit "${TE2_RELEASE_COMMIT}" \
  --release-tag "${TE2_RELEASE_TAG}" \
  --platform-tag "${TE2_RELEASE_PLATFORM_TAG}" \
  --minimum-glibc "${TE2_RELEASE_MINIMUM_GLIBC}" \
  --source-date-epoch "${SOURCE_DATE_EPOCH}" \
  --builder-image "${TE2_RELEASE_BUILDER_IMAGE}"
