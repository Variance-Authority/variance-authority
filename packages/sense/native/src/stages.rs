//! The stage clock: with `VARIANCE_AUTHORITY_INDEX_STAGES` set, each stage of
//! a native index run writes one line to stderr, its wall time and the
//! process's peak resident memory at its end; unset, nothing is timed.
//!
//! A sequential stage (listing, walk, records, encode, write) is wall time, so
//! those lines sum to the run's. Read, parse and resolve overlap inside the
//! walk, on every core, so each is the thread time summed over the files, and
//! the walk's line carries them.

// compass: variance-authority.reach.source-index

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Whether the variable is set: read once, so a stage that is not timed costs one load.
pub(crate) fn on() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("VARIANCE_AUTHORITY_INDEX_STAGES").is_some_and(|value| !value.is_empty() && value != "0"))
}

/// Thread time summed over the files of the walk that is running.
pub(crate) static READ: AtomicU64 = AtomicU64::new(0);
pub(crate) static PARSE: AtomicU64 = AtomicU64::new(0);
pub(crate) static RESOLVE: AtomicU64 = AtomicU64::new(0);

/// `work`, its time added to `sum` when the clock is on.
pub(crate) fn summed<T>(sum: &AtomicU64, work: impl FnOnce() -> T) -> T {
    if !on() {
        return work();
    }
    let started = Instant::now();
    let done = work();
    sum.fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    done
}

/// A sequential stage, started now; [`Stage::end`] writes its line.
pub(crate) struct Stage(Option<(&'static str, Instant)>);

pub(crate) fn start(name: &'static str) -> Stage {
    Stage(on().then(|| (name, Instant::now())))
}

impl Stage {
    pub(crate) fn end(self) {
        if let Some((name, started)) = self.0 {
            eprintln!("variance stage {name}: {}, peak {}", seconds(started.elapsed()), peak());
        }
    }

    /// The walk's end: its wall time, with the summed thread times of what overlapped in it, which it resets.
    pub(crate) fn end_walk(self) {
        if let Some((name, started)) = self.0 {
            let take = |sum: &AtomicU64| Duration::from_nanos(sum.swap(0, Ordering::Relaxed));
            let (parse, read_and_parse, resolve) = (take(&PARSE), take(&READ), take(&RESOLVE));
            let read = read_and_parse.saturating_sub(parse);
            eprintln!(
                "variance stage {name}: {}, peak {} (thread time: read {}, parse {}, resolve {})",
                seconds(started.elapsed()),
                peak(),
                seconds(read),
                seconds(parse),
                seconds(resolve)
            );
        }
    }
}

fn seconds(time: Duration) -> String {
    format!("{:.3} s", time.as_secs_f64())
}

/// The process's peak resident memory so far, where the platform gives it.
fn peak() -> String {
    #[cfg(unix)]
    {
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: `getrusage` fills the struct it is handed and reads nothing else.
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0 {
            // SAFETY: a zero return means the struct was written.
            let maximum = unsafe { usage.assume_init() }.ru_maxrss as u64;
            // macOS counts bytes, Linux kibibytes.
            let bytes = if cfg!(target_os = "macos") { maximum } else { maximum * 1024 };
            return format!("{:.2} GB", bytes as f64 / 1e9);
        }
    }
    "unknown".to_string()
}
