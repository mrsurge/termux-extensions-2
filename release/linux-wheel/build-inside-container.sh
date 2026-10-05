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

rm -rf /work/source /work/package-dist /work/repaired \
  /work/code-te2-dependencies /work/code-te2-domain /work/code-te2-payload \
  /work/code-te2-launch-probe
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

# Independently build the raw pipe-facing app executable and its compiled domain.
export PYO3_PYTHON="$(command -v python)"
python -m pip install --only-binary=:all: \
  -r release/linux-wheel/code-te2-runtime-requirements.txt \
  mypy==2.3.0
python -m pip install --only-binary=:all: --no-deps \
  --target /work/code-te2-dependencies \
  -r release/linux-wheel/code-te2-runtime-requirements.txt
python -B scripts/probe_code_te2_launch_context.py \
  --output /work/code-te2-launch-probe
cargo build --locked --release \
  --manifest-path framework/native_editor_worker/Cargo.toml --bin code-te2-worker
worker="${CARGO_TARGET_DIR}/release/code-te2-worker"
strip --strip-unneeded "${worker}"
MAX_JOBS="${MAX_JOBS:-2}" python -B scripts/probe_code_te2_mypyc.py build \
  --output /work/code-te2-domain --cache-dir /work/code-te2-mypyc-cache
package_version="$(python -c 'import tomllib; print(tomllib.load(open("pyproject.toml","rb"))["project"]["version"])')"
worker_fingerprint="$(sha256sum "${worker}" | cut -d ' ' -f 1)"
python -B scripts/materialize_code_te2_runtime.py \
  --snapshot /work/code-te2-domain --worker "${worker}" \
  --output /work/code-te2-payload --package-version "${package_version}" \
  --rust-fingerprint "${worker_fingerprint}" \
  --private-python /opt/te2-python/runtime \
  --private-dependencies /work/code-te2-dependencies
# Loader paths are relative to each ELF; no build-host /opt or venv paths ship.
patchelf --set-rpath '$ORIGIN/../python/lib' /work/code-te2-payload/bin/code-te2-worker
patchelf --set-rpath '$ORIGIN/../lib' /work/code-te2-payload/python/bin/python3.14
# The stable-ABI stub uses a relative DT_NEEDED pathname. Normalize it to the
# bundled SONAME so repair tools resolve it through the relative RPATH.
patchelf --replace-needed '$ORIGIN/../lib/libpython3.14.so.1.0' libpython3.14.so.1.0 \
  /work/code-te2-payload/python/lib/libpython3.so
patchelf --set-rpath '$ORIGIN' /work/code-te2-payload/python/lib/libpython3.so
python -B scripts/finalize_code_te2_payload.py /work/code-te2-payload

env \
  -u TE2_RELEASE_SERVER_BIN \
  -u TE2_RELEASE_PLATFORM_TAG \
  -u TE2_RELEASE_MINIMUM_GLIBC \
  -u TE2_RELEASE_TAG \
  -u TE2_RELEASE_COMMIT \
  -u TE2_RELEASE_CODE_TE2_RUNTIME \
  python -m build --sdist --no-isolation --outdir /work/package-dist .

export TE2_RELEASE_SERVER_BIN="${server}"
export TE2_RELEASE_SERVER_VERSION="$("${server}" --build-info | python -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
export TE2_RELEASE_CODE_TE2_RUNTIME=/work/code-te2-payload
python -m build --wheel --no-isolation --outdir /work/package-dist .

preliminary_wheel="$(find /work/package-dist -maxdepth 1 -type f -name '*.whl' -print -quit)"
sdist="$(find /work/package-dist -maxdepth 1 -type f -name '*.tar.gz' -print -quit)"
test -n "${preliminary_wheel}"
test -n "${sdist}"

LD_LIBRARY_PATH="/work/code-te2-payload/python/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}" auditwheel repair \
  --exclude libpython3.14.so.1.0 \
  --plat "${TE2_RELEASE_PLATFORM_TAG}" \
  --wheel-dir /work/repaired \
  "${preliminary_wheel}"
wheel="$(find /work/repaired -maxdepth 1 -type f -name '*.whl' -print -quit)"
test -n "${wheel}"
# auditwheel can rewrite ELF content; update the inner inventory and outer
# RECORD together, then validate the rewritten set before promotion.
python -B scripts/finalize_code_te2_payload.py --wheel "${wheel}"

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
