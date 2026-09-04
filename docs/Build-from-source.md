## Requirements

- Rust 1.75+ ([rustup.rs](https://rustup.rs))
- C compiler (gcc or clang)
- CMake, Clang, and the libclang/LLVM development libraries
- ~5 GB free disk space (V8 compiles from source on first build)

CMake and libclang are required for the default build: stealth is part of the
default feature set and compiles BoringSSL. A `--no-default-features` build
uses rustls and needs none of them. See
[BoringSSL toolchain](#boringssl-toolchain) for per-platform details.

First build takes about 5 minutes. Incremental builds are seconds.

## Build

```bash
git clone https://github.com/h4ckf0r0day/obscura.git
cd obscura
cargo build --release -p obscura-cli --bins --features render
```

Binary is at `./target/release/obscura`.

This is the complete build: geometry, screenshots, screencasting, and PDF
export from `render`, plus the stealth wreq/BoringSSL transport, TLS
fingerprint randomization, browser-identity protections, and tracker blocklist
from the default feature set. See
[Configure stealth and proxies](Configure-stealth-and-proxies.md).

## Rendering only

```bash
cargo build --release -p obscura-cli --bins --no-default-features --features render
```

`--no-default-features` turns stealth off across the whole dependency chain, so
this build uses rustls and needs neither CMake nor libclang.

## Without rendering

```bash
cargo build --release -p obscura-cli --bins
cargo build --release -p obscura-cli --bins --no-default-features
```

The first command keeps stealth while excluding layout, screenshots,
screencasting, and PDF export. The second excludes both.

## BoringSSL toolchain

The stealth feature builds BoringSSL and generates Rust bindings, so this
applies to every build that does not pass `--no-default-features`. Install
CMake, Clang, and the libclang/LLVM development libraries. On Ubuntu/Debian:

```bash
sudo apt-get install build-essential cmake clang libclang-dev llvm-dev
```

On macOS, install the Xcode Command Line Tools and CMake. On Windows, install
the Visual Studio C++ Build Tools, CMake, and LLVM/Clang. Ensure the directory
containing `libclang` is available through `LIBCLANG_PATH` if bindgen cannot
locate it automatically.

On macOS 26 with the standalone Command Line Tools, Apple Clang may not find
libc++ while compiling BoringSSL. Use the active SDK for that build:

```bash
SDK_PATH="$(xcrun --show-sdk-path)"
SDKROOT="$SDK_PATH" CXXFLAGS="-isystem $SDK_PATH/usr/include/c++/v1" \
  cargo build --release -p obscura-cli --bins --features render
```

## OpenSSL on older systems

If the build fails on the vendored OpenSSL with an AVX-512 assembler error (common on older VPS hosts):

```bash
OPENSSL_NO_VENDOR=1 cargo build --release -p obscura-cli --bins --features render
```

Uses the system OpenSSL instead.

## Run from the build

```bash
./target/release/obscura --version
./target/release/obscura fetch https://example.com --eval "document.title"
```

Install system-wide:

```bash
cargo install --path crates/obscura-cli --features render
```

## Tests

```bash
cargo nextest run --release --features render --no-fail-fast
```

Integration suite:

```bash
python3 tests/test_all.py
```

Use `cargo nextest`, not `cargo test`: runtime tests require process isolation
because the engine owns a single V8 isolate per process.

## Building against the vendored V8 source

The native iv8 API monitor does not require a V8 source patch. A source build is
still useful when the page needs the `document.all` bindings supplied by
`vendor/v8-rusty-extras.sh`. `vendor/v8-source.toml` carries both the
`[patch.crates-io]` entry pointing at `vendor/rusty_v8` and `V8_FROM_SOURCE=1`;
passing one without the other selects the wrong rusty_v8 build path, so they
live in one file:

```bash
cargo build --release -p obscura-cli --bins --features render \
  --config vendor/v8-source.toml
```

`.cargo/config.toml` defines aliases for the usual shapes:

| Alias | Equivalent to |
| --- | --- |
| `cargo v8-build` | the command above |
| `cargo v8-build-lean` | same, with `--no-default-features` |
| `cargo v8-check` | `cargo check -p obscura-js -p obscura-cli` |
| `cargo v8-test` | `cargo nextest run --release --no-fail-fast --features render` |

These are opt-in: normal builds, the release workflow and the Docker image link
the prebuilt `librusty_v8.a` and never compile V8 from source. Building it from
source takes about 30 minutes the first time.
