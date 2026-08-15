use std::sync::Once;

static INIT: Once = Once::new();
static BASELINE: Once = Once::new();

/// Flags this engine always runs with, regardless of what the caller passes.
///
/// `--enable-sharedarraybuffer-per-context` stops V8 installing the
/// `SharedArrayBuffer` global. Without it, `Genesis::InitializeGlobal_
/// sharedarraybuffer` adds the property to every context it builds --
/// including one deserialized from our startup snapshot -- so deleting the
/// binding in bootstrap.js cannot work: bootstrap runs while the snapshot is
/// being *created*, and the property is put back when the snapshot is
/// *loaded*. That is what "something re-installs it after bootstrap runs"
/// was.
///
/// With the flag set, V8 asks `SetSharedArrayBufferConstructorEnabledCallback`
/// instead, and with no callback registered the answer is no. This is the same
/// mechanism Chrome uses, and it matches what Chrome 146 actually does:
/// `SharedArrayBuffer` is not a global without cross-origin isolation
/// (COOP+COEP -- stricter than a secure context, so it is absent on loopback
/// too), while the constructor itself still exists. A shared
/// `WebAssembly.Memory`'s buffer reports `constructor.name ===
/// 'SharedArrayBuffer'` and `[object SharedArrayBuffer]` on an insecure
/// origin, with `constructor !== globalThis.SharedArrayBuffer` because the
/// global is undefined. Deleting the binding would have hidden the name while
/// leaving that path reporting something else; see
/// js-repros/secure-context/chrome-oracle.json.
const BASELINE_V8_FLAGS: &str = "--enable-sharedarraybuffer-per-context";

/// Apply the flags this engine requires, before the first isolate exists.
///
/// Separate from [`set_v8_flags`] because that one is driven by a CLI option
/// and is a no-op when nothing was passed -- which is every test in the
/// workspace and every embedder that does not go through the CLI.
pub(crate) fn apply_baseline_v8_flags() {
    BASELINE.call_once(|| {
        deno_core::v8::V8::set_flags_from_string(BASELINE_V8_FLAGS);
    });
}

/// Apply user-supplied V8 flags exactly once, before the first isolate is
/// created.
///
/// `flags` is a raw V8 flag string in the same form V8/Chromium/Node accept
/// (e.g. `"--max-old-space-size=4096 --max-semi-space-size=64"`). An empty or
/// whitespace-only string is a no-op and does not consume the one-shot guard,
/// so a later non-empty call still takes effect.
///
/// V8 ignores `set_flags_from_string` once the platform is initialized, so the
/// first non-empty call must run before any `JsRuntime` is constructed.
/// Subsequent calls are silently dropped.
pub fn set_v8_flags(flags: &str) {
    let trimmed = flags.trim();
    if trimmed.is_empty() {
        return;
    }
    INIT.call_once(|| {
        deno_core::v8::V8::set_flags_from_string(trimmed);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_noop() {
        // Must not panic and must not consume the Once guard.
        set_v8_flags("");
        set_v8_flags("   ");
        set_v8_flags("\t\n");
    }
}
