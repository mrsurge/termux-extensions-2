FROM quay.io/pypa/manylinux_2_28_x86_64@sha256:4dc41da7df20400310c80d162a2fe2d2c2f3d9734d8dec20f6b9843711618deb

ARG RUST_VERSION=1.94.0
ARG RUSTUP_INIT_SHA256=dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71
ARG UV_VERSION=0.11.26
ARG TE2_PYTHON_VERSION=3.14.6

ENV PATH="/opt/cargo/bin:/opt/python/cp312-cp312/bin:${PATH}" \
    RUSTUP_HOME=/opt/rustup

RUN dnf install -y perl-core ccache libarchive openssl-devel pkgconf-pkg-config && dnf clean all
RUN curl --proto '=https' --tlsv1.2 -fsSLo /root/rustup-init \
      https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init \
    && echo "${RUSTUP_INIT_SHA256}  /root/rustup-init" | sha256sum --check --strict \
    && chmod +x /root/rustup-init \
    && CARGO_HOME=/opt/cargo /root/rustup-init -y --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rm -f /root/rustup-init
RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}" \
    && UV_PYTHON_INSTALL_DIR=/opt/te2-python uv python install "${TE2_PYTHON_VERSION}" \
    && python_path="$(UV_PYTHON_INSTALL_DIR=/opt/te2-python uv python find --managed-python "${TE2_PYTHON_VERSION}")" \
    && ln -s "$(dirname "$(dirname "${python_path}")")" /opt/te2-python/runtime \
    && uv venv --python "${python_path}" /opt/te2-build-venv \
    && uv pip install --python /opt/te2-build-venv/bin/python --no-cache \
      pip==25.1.1 \
      auditwheel==6.7.0 \
      build==1.3.0 \
      setuptools==84.0.0 \
      wheel==0.48.0

ENV PATH="/opt/te2-build-venv/bin:${PATH}" \
    PYO3_PYTHON=/opt/te2-build-venv/bin/python \
    CC=gcc \
    CXX=g++
RUN python -c 'import sys,sysconfig; assert sys.version_info[:2] == (3,14); assert not sysconfig.get_config_var("Py_GIL_DISABLED"); assert sysconfig.get_config_var("Py_ENABLE_SHARED") == 1'

COPY build-inside-container.sh /usr/local/bin/te2-build-linux-wheel
COPY validate-artifacts.py /usr/local/libexec/te2-validate-linux-wheel
RUN chmod 0755 /usr/local/bin/te2-build-linux-wheel

ENTRYPOINT ["/usr/local/bin/te2-build-linux-wheel"]
