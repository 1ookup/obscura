//! `window.external.tracelog(key, value)`: the caller-supplied trace sink.
//!
//! The instrumented Chrome build this engine is diffed against exposes
//! `window.external.tracelog` to page code. Every call appends one JSON line to
//! `<user-data-dir>/<profile>/tracelog/trace.jsonl` in the shape
//! `{"t":<us>,"k":<key>,"v":<json>}`, with the value serialized by
//! `JSON.stringify` on the calling (isolate) thread and an empty result written
//! as `null`. Obscura implements the same contract so a patched challenge
//! script runs on either engine unmodified; see `docs/native-trace.md`.
//!
//! Opt-in. `--tracelog-file FILE` (or `OBSCURA_TRACELOG_FILE`) both points this
//! sink at a file and is what makes the bootstrap install the method, so a
//! production run exposes Chrome's stock `External` surface exactly and page
//! code cannot ask it to write anywhere.
//!
//! Performance: an instrumented VM writes hundreds of thousands of records, so
//! the line is queued and a single writer thread drains it in batches (1000
//! records, 1 MiB, or 100 ms, whichever comes first), opening the file in
//! append mode once per batch. That mirrors the reference split between the
//! isolate that serializes and the writer that owns the file. A backlog past
//! the queue bound is dropped rather than grown, which is also what the
//! reference does when its queue saturates.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// Records or bytes buffered before a batch is written.
const BATCH_RECORDS: usize = 1000;
const BATCH_BYTES: usize = 1024 * 1024;
/// How long a record may sit in the queue before the writer starts a batch.
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);
/// Queue bound. Past this, records are dropped: page memory is worth more than
/// completeness of a trace.
const MAX_PENDING_RECORDS: usize = 100_000;
const MAX_PENDING_BYTES: usize = 64 * 1024 * 1024;

/// Whether a tracelog destination is configured. Read once per process: the
/// runtime decides snapshot skipping from it before the first isolate exists,
/// and the bootstrap installs the method only when it holds.
pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| destination().is_some())
}

/// The destination file, from `--tracelog-file` or `OBSCURA_TRACELOG_FILE`.
/// There is no implicit default: a run that did not ask for a tracelog does not
/// get the method, and page code cannot make one write a file.
pub fn destination() -> Option<PathBuf> {
    let configured = std::env::var_os("OBSCURA_TRACELOG_FILE")?;
    if configured.is_empty() {
        return None;
    }
    Some(PathBuf::from(configured))
}

/// Append the execution-source label (`window`, `iframe(N)`,
/// `worker(M)[creator]`, `script@<url>`, ...) as a fourth field. Off by
/// default, which keeps the record byte-identical to the instrumented build's
/// three-field shape. The label only exists to stamp these records, so the
/// variable does nothing without a destination to stamp.
pub fn labels_requested() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        enabled()
            && std::env::var("OBSCURA_TRACELOG_FROM")
                .is_ok_and(|value| !value.is_empty() && value != "0" && value != "off")
    })
}

/// One page-visible call. `json` is the caller's serialized value, empty when
/// serialization produced nothing (which is written as `null`).
pub fn record(key: &str, json: &str) {
    let Some(sink) = sink() else {
        // The bootstrap installs the method only when a destination exists, so
        // reaching here means a host caller lost its records rather than a page
        // that never asked for them. Say so once instead of dropping silently.
        warn_unconfigured();
        return;
    };
    let from = labels_requested().then(crate::trace_source::effective);
    let line = format_record(key, json, from.as_deref());

    let counters = &sink.counters;
    if counters.pending_records.load(Ordering::Relaxed) >= MAX_PENDING_RECORDS
        || counters.pending_bytes.load(Ordering::Relaxed) >= MAX_PENDING_BYTES
    {
        counters.dropped.fetch_add(1, Ordering::Relaxed);
        return;
    }
    let len = line.len();
    counters.pending_records.fetch_add(1, Ordering::Relaxed);
    counters.pending_bytes.fetch_add(len, Ordering::Relaxed);
    if sink.tx.send(Message::Record(line)).is_err() {
        counters.pending_records.fetch_sub(1, Ordering::Relaxed);
        counters.pending_bytes.fetch_sub(len, Ordering::Relaxed);
    }
}

/// Write everything queued so far and wait for it to land. Called on the way
/// out of a CLI command; a long-lived server does not need it, since the writer
/// thread's interval already covers the tail there.
pub fn flush() {
    let Some(sink) = sink() else { return };
    let (done_tx, done_rx) = mpsc::channel();
    if sink.tx.send(Message::Flush(done_tx)).is_ok() {
        let _ = done_rx.recv_timeout(Duration::from_secs(10));
    }
}

enum Message {
    Record(String),
    Flush(Sender<()>),
}

#[derive(Default)]
struct Counters {
    pending_records: AtomicUsize,
    pending_bytes: AtomicUsize,
    dropped: AtomicU64,
}

struct Sink {
    tx: Sender<Message>,
    counters: Arc<Counters>,
}

fn sink() -> Option<&'static Sink> {
    static SINK: OnceLock<Option<Sink>> = OnceLock::new();
    SINK.get_or_init(|| {
        let path = destination()?;
        let (tx, rx) = mpsc::channel();
        let counters = Arc::new(Counters::default());
        let writer_counters = counters.clone();
        // One writer per process, shared by the page isolate, every frame realm
        // and every worker isolate. A failed spawn leaves the sink inert rather
        // than panicking inside an op.
        std::thread::Builder::new()
            .name("obscura-tracelog".to_string())
            .spawn(move || write_loop(rx, path, writer_counters))
            .ok()?;
        Some(Sink { tx, counters })
    })
    .as_ref()
}

fn write_loop(rx: mpsc::Receiver<Message>, path: PathBuf, counters: Arc<Counters>) {
    let mut batch = String::with_capacity(BATCH_BYTES);
    let mut records = 0usize;
    let mut directory_ready = false;
    let mut reported_unwritable = false;
    loop {
        let flush_now;
        let mut acknowledge: Option<Sender<()>> = None;
        match rx.recv_timeout(FLUSH_INTERVAL) {
            Ok(Message::Record(line)) => {
                counters.pending_records.fetch_sub(1, Ordering::Relaxed);
                counters.pending_bytes.fetch_sub(line.len(), Ordering::Relaxed);
                batch.push_str(&line);
                records += 1;
                flush_now = records >= BATCH_RECORDS || batch.len() >= BATCH_BYTES;
            }
            Ok(Message::Flush(done)) => {
                flush_now = true;
                acknowledge = Some(done);
            }
            Err(RecvTimeoutError::Timeout) => flush_now = records > 0,
            Err(RecvTimeoutError::Disconnected) => {
                write_batch(&path, &mut batch, &mut records, &mut directory_ready, &mut reported_unwritable);
                break;
            }
        }
        if flush_now {
            write_batch(&path, &mut batch, &mut records, &mut directory_ready, &mut reported_unwritable);
            report_dropped(&counters);
            // Acknowledged after the bytes are written, so a caller that flushes
            // before exiting sees its records in the file.
            if let Some(done) = acknowledge {
                let _ = done.send(());
            }
        }
    }
}

fn write_batch(
    path: &Path,
    batch: &mut String,
    records: &mut usize,
    directory_ready: &mut bool,
    reported_unwritable: &mut bool,
) {
    if *records == 0 {
        return;
    }
    *records = 0;
    if !*directory_ready {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        *directory_ready = true;
    }
    // Opened per batch in append mode, like the reference writer: concurrent
    // processes (scrape workers, a multi-worker server) share one file, and the
    // kernel serializes the appends.
    match std::fs::OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            let _ = file.write_all(batch.as_bytes());
        }
        Err(error) => {
            if !*reported_unwritable {
                *reported_unwritable = true;
                tracing::warn!(
                    "tracelog: cannot write {}: {error}; further records are dropped",
                    path.display()
                );
            }
        }
    }
    batch.clear();
}

fn report_dropped(counters: &Counters) {
    let dropped = counters.dropped.swap(0, Ordering::Relaxed);
    if dropped > 0 {
        tracing::warn!("tracelog: dropped {dropped} record(s) while the writer was behind");
    }
}

fn warn_unconfigured() {
    static WARNED: OnceLock<()> = OnceLock::new();
    WARNED.get_or_init(|| {
        tracing::warn!(
            "window.external.tracelog called with no destination; \
             pass --tracelog-file FILE or set OBSCURA_TRACELOG_FILE"
        );
    });
}

fn format_record(key: &str, json: &str, from: Option<&str>) -> String {
    let mut line = String::with_capacity(key.len() + json.len() + 48);
    line.push_str("{\"t\":");
    line.push_str(&monotonic_us().to_string());
    line.push_str(",\"k\":\"");
    escape_json_into(&mut line, key);
    line.push_str("\",\"v\":");
    if json.is_empty() {
        // A value V8 could not stringify (undefined, a function, a throw from a
        // getter) reads as null, which is what the reference writes when
        // JSON::Stringify yields nothing.
        line.push_str("null");
    } else {
        line.push_str(json);
    }
    if let Some(from) = from {
        line.push_str(",\"from\":\"");
        escape_json_into(&mut line, from);
        line.push('"');
    }
    line.push_str("}\n");
    line
}

/// Escape what JSON requires inside a string literal. Keys are caller-supplied
/// strings, so a quote or a line break in one must not break the file's line
/// structure. Bytes above the control range pass through as UTF-8.
fn escape_json_into(out: &mut String, value: &str) {
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
}

/// Microseconds on the platform monotonic clock. The reference stamps records
/// with `base::TimeTicks::Now().since_origin().InMicroseconds()`, which is
/// mach_absolute_time on macOS and CLOCK_MONOTONIC elsewhere; using the same
/// clock domain means tracelogs from either engine on one host are ordered
/// against each other. Only deltas inside one file are meaningful.
#[cfg(unix)]
fn monotonic_us() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    // SAFETY: clock_gettime writes into a timespec owned by this frame.
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) } == 0 {
        return (ts.tv_sec as u64) * 1_000_000 + (ts.tv_nsec as u64) / 1_000;
    }
    fallback_monotonic_us()
}

#[cfg(not(unix))]
fn monotonic_us() -> u64 {
    fallback_monotonic_us()
}

/// Non-unix fallback (and a failed clock_gettime): process-relative, which
/// keeps deltas meaningful even though the base differs from the reference's.
fn fallback_monotonic_us() -> u64 {
    static EPOCH: OnceLock<std::time::Instant> = OnceLock::new();
    EPOCH.get_or_init(std::time::Instant::now).elapsed().as_micros() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_is_one_json_line_in_the_reference_shape() {
        let line = format_record("ov2.h.RN", r#"{"pc":1,"key":204}"#, None);
        assert!(line.starts_with("{\"t\":"), "{line}");
        assert!(
            line.ends_with(",\"k\":\"ov2.h.RN\",\"v\":{\"pc\":1,\"key\":204}}\n"),
            "{line}"
        );
        // One line: the file is line-delimited JSON, so a key with a newline in
        // it must not become two records.
        assert_eq!(line.matches('\n').count(), 1, "{line}");
        let timestamp: u64 = line["{\"t\":".len()..line.find(",\"k\":").unwrap()]
            .parse()
            .expect("monotonic microseconds");
        assert!(timestamp > 0);
    }

    #[test]
    fn an_unstringifiable_value_reads_as_null() {
        let line = format_record("k", "", None);
        assert!(line.contains("\"v\":null}\n"), "{line}");
    }

    #[test]
    fn the_label_is_a_trailing_field_so_the_three_field_shape_is_a_prefix() {
        let line = format_record("k", "1", Some("worker(1)[script@https://a/b.js]"));
        assert!(
            line.ends_with(",\"from\":\"worker(1)[script@https://a/b.js]\"}\n"),
            "{line}"
        );
    }

    #[test]
    fn key_escaping_keeps_one_record_per_line() {
        let line = format_record("a\"b\\c\nd", "1", None);
        assert_eq!(line.matches('\n').count(), 1, "{line}");
        assert!(line.contains(r#""k":"a\"b\\c\nd""#), "{line}");
    }
}
