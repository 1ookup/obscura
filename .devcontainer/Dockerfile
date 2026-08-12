# Base image ships rustup + a stable toolchain and a non-root `vscode` user.
FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

# cmake/clang/libclang/llvm are the stealth build's requirements: the wreq
# transport builds BoringSSL through CMake and binds it with bindgen (see the
# Linux step in .github/workflows/release.yml). perl + make are what the
# vendored OpenSSL fallback needs; python3 runs the obstacle course from the
# companion obscura-benchmark repo.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        cmake \
        ninja-build \
        clang \
        libclang-dev \
        llvm-dev \
        pkg-config \
        perl \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# nextest is the only supported test runner: the engine holds a single V8
# isolate per process, so `cargo test`'s one-process-per-binary model fails the
# runtime tests. Install the prebuilt binary — `cargo install` would rebuild it
# from source on every image build.
RUN arch="$(uname -m)" \
    && case "$arch" in \
         x86_64)  url="https://get.nexte.st/latest/linux" ;; \
         aarch64) url="https://get.nexte.st/latest/linux-arm" ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "$url" | tar zxf - -C /usr/local/bin \
    && cargo-nextest --version

# Node is not in the Rust base image, and both coding CLIs below ship as npm
# packages. NodeSource tracks the 22.x LTS line for us instead of pinning a
# patch release that goes stale.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Installed as root into /usr/local so `vscode` can run them but not silently
# self-update the shared install. Both pick up their config from the mounts
# declared in devcontainer.json.
RUN npm install -g --no-fund --no-audit \
        @anthropic-ai/claude-code \
        @openai/codex \
    && npm cache clean --force \
    && claude --version \
    && codex --version
