FROM quay.io/pypa/manylinux_2_28_x86_64@sha256:4dc41da7df20400310c80d162a2fe2d2c2f3d9734d8dec20f6b9843711618deb

ARG RUST_VERSION=1.93.0
ARG RUSTUP_INIT_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10

ENV PATH="/opt/cargo/bin:/opt/python/cp312-cp312/bin:${PATH}" \
    RUSTUP_HOME=/opt/rustup

RUN dnf install -y perl-core && dnf clean all
RUN curl --proto '=https' --tlsv1.2 -fsSLo /root/rustup-init \
      https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init \
    && echo "${RUSTUP_INIT_SHA256}  /root/rustup-init" | sha256sum --check --strict \
    && chmod +x /root/rustup-init \
    && CARGO_HOME=/opt/cargo /root/rustup-init -y --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rm -f /root/rustup-init
RUN python -m pip install --no-cache-dir \
      auditwheel==6.7.0 \
      build==1.3.0 \
      setuptools==84.0.0 \
      wheel==0.48.0

COPY build-inside-container.sh /usr/local/bin/te2-build-linux-wheel
COPY validate-artifacts.py /usr/local/libexec/te2-validate-linux-wheel
RUN chmod 0755 /usr/local/bin/te2-build-linux-wheel

ENTRYPOINT ["/usr/local/bin/te2-build-linux-wheel"]
