//! Execution-source attribution (`from` labels) for the trace streams.
//!
//! The label taxonomy mirrors the HaHaVM dispatch-trace `from` field so traces
//! from the two engines can be diffed by the code unit that produced each
//! record:
//!
//! | label | meaning |
//! | --- | --- |
//! | `window` | code in the main document's default scope |
//! | `iframe(N)` | code in a frame realm; N from the host's cross-frame counter |
//! | `worker(M)[creator]` | worker code; M from the host worker counter, creator from the constructing context's label at `new Worker(...)` |
//! | `script@<url>` | a classic script file (inline or external) |
//! | `function@<source>` | a `new Function(...)` product, attributed to its creation source |
//! | `eval@<source>` | eval'd string code (boundary: direct eval is not attributable in V8) |
//! | `host` | host-injected code (`Page::evaluate`, CDP evaluate, preloads, `--eval`) |
//!
//! The authoritative state lives here, thread-local in Rust: an ambient label
//! per context plus a stack of explicit entries. The JS bootstrap mirrors the
//! stack (it needs to read the current label for snapshotting continuations)
//! and keeps the two in lockstep through `op_trace_push_source` /
//! `op_trace_pop_source`. Rust-side funnels set the ambient label; host
//! injections push an explicit entry through [`push`].
//!
//! Everything is inert unless a trace stream is active
//! ([`enabled`]); with tracing off no label is written and no
//! wrapper is installed in the bootstrap, so the page-visible surface is
//! unchanged.

use std::cell::RefCell;

thread_local! {
    /// Ambient label of the context the runtime is about to execute in
    /// ("window", "iframe(N)", "worker(M)[...]"). Set by the Rust execution
    /// funnels, which know the target context.
    static AMBIENT: RefCell<String> = const { RefCell::new(String::new()) };
    /// Explicit entries pushed by labeled code units (script@..., host, ...).
    /// Innermost entry wins over the ambient label.
    static STACK: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Whether any trace stream requested execution-source labels. Mirrors the
/// runtime's snapshot-skip decision: a traced run re-executes the bootstrap
/// with `__obscura_trace_from_enabled` set, which is what installs the JS-side
/// wrappers.
///
/// The tracelog sink counts as a stream only when it was asked to stamp its
/// records with the label ([`crate::tracelog::labels_requested`]): without that
/// field the labels would add the wrapper cost to a run with nothing reading
/// them off.
pub fn enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| {
        std::env::var_os("OBSCURA_TRACE_OP_FILE").is_some()
            || std::env::var_os("OBSCURA_TRACE_API_FILE").is_some()
            || crate::tracelog::labels_requested()
    })
}

/// The label a traced record in the currently-executing code should carry.
pub fn effective() -> String {
    let stacked = STACK.with(|stack| stack.borrow().last().cloned());
    match stacked {
        Some(label) => label,
        None => {
            let ambient = AMBIENT.with(|ambient| ambient.borrow().clone());
            if ambient.is_empty() {
                "window".to_string()
            } else {
                ambient
            }
        }
    }
}

/// Set the ambient label for the context the runtime is about to execute in.
/// Cheap no-op when tracing is off, which is the production path.
pub fn set_ambient(label: &str) {
    if !enabled() {
        return;
    }
    AMBIENT.with(|ambient| *ambient.borrow_mut() = label.to_string());
}

/// Restore point for [`push`]: pops the stack back to its prior depth, so a
/// leaked entry from a terminated script cannot outlive its bracket.
pub struct TraceSourceGuard {
    depth: usize,
}

impl Drop for TraceSourceGuard {
    fn drop(&mut self) {
        STACK.with(|stack| {
            let mut stack = stack.borrow_mut();
            stack.truncate(self.depth);
        });
    }
}

/// Push an explicit label for host-injected code. The returned guard pops the
/// stack back to its prior depth on drop, including any entries leaked by
/// nested JS that was terminated mid-script.
pub fn push(label: &str) -> TraceSourceGuard {
    let depth = STACK.with(|stack| {
        let mut stack = stack.borrow_mut();
        stack.push(label.to_string());
        stack.len() - 1
    });
    TraceSourceGuard { depth }
}

/// JS-side entry into a labeled code unit (script@..., continuation restore).
/// The bootstrap mirrors its own stack; this is the write side that keeps the
/// Rust stack authoritative for ops that trace.
pub(crate) fn js_push(label: &str) {
    if !enabled() {
        return;
    }
    STACK.with(|stack| stack.borrow_mut().push(label.to_string()));
}

/// JS-side exit from a labeled code unit.
pub(crate) fn js_pop() {
    if !enabled() {
        return;
    }
    STACK.with(|stack| stack.borrow_mut().pop());
}
