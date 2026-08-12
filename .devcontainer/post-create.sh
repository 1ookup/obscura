#!/usr/bin/env bash
# Runs once after the container is created.
set -euo pipefail

CARGO="${CARGO_HOME:-/usr/local/cargo}"

# The cache mounts in devcontainer.json are named Docker volumes, created
# root-owned. Everything here runs as `vscode`, so hand over the directories.
# Non-recursive on purpose: the CLI config files bind-mounted inside
# ~/.claude and ~/.codex belong to the host, and chown -R would either fail
# on them or rewrite ownership in the repo.
sudo chown "$(id -u):$(id -g)" \
    "$CARGO/registry" \
    "$CARGO/git" \
    "$(pwd)/target" \
    "$HOME/.claude" \
    "$HOME/.codex"

# Warm the registry so the first build only pays for compilation. This also
# resolves the [patch.crates-io] entries pointing at vendor/taffy and
# vendor/cosmic-text, surfacing a broken checkout now rather than mid-build.
cargo fetch --locked

# Fail loudly at setup rather than on the first API call.
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
    echo "  warning: ANTHROPIC_AUTH_TOKEN is empty — export it on the host, then rebuild." >&2
fi
if [ -z "${CUSTOM_API_KEY:-}" ]; then
    echo "  warning: CUSTOM_API_KEY is empty — codex will not authenticate." >&2
fi
if grep -q 'REPLACE-ME' "$HOME/.claude/settings.json" "$HOME/.codex/config.toml" 2>/dev/null; then
    echo "  warning: base URL placeholders still present in .devcontainer/{claude,codex}." >&2
fi

cat <<'EOF'

  Obscura dev container ready.

  First build compiles V8 from source (~5 min, a few GB of disk):

    CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 \
      cargo build --release -p obscura-cli --bins --features render

  Test with nextest, never `cargo test`:

    cargo nextest run --release --features render -p <crate>

  target/ and the cargo registry live on named volumes, so rebuilding the
  container does not throw the V8 build away. claude and codex read their
  model config from .devcontainer/{claude,codex}; keys come from the host
  environment and are never written to the repo.

EOF
