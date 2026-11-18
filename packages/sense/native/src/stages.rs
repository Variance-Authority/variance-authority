//! The stage clock: with `VARIANCE_AUTHORITY_INDEX_STAGES` set, each stage of
//! a native index run writes one line to stderr, its wall time and the
//! process's peak resident memory at its end; unset, nothing is timed.
//!
//! A sequential stage (listing, walk, records, encode, write) is wall time, so
//! those lines sum to the run's. Read, parse and resolve overlap inside the
//! walk, on every core, so each is the thread time summed over the files, and
//! the walk's line carries them.
//! The sums are the process's: two walks running at once in one process would
//! share them, and the index runs one update at a time.

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

/// A part of the listing, in the order its line prints them. `Tree` and
/// `Worktree` run at once, so the parts do not sum to the listing's line; a
/// part that did not run prints nothing.
#[derive(Clone, Copy)]
pub(crate) enum Part {
    Head,
    Held,
    Tree,
    LsTree,
    Worktree,
    GitStatus,
    Compare,
    HashObject,
    Merge,
    Seeds,
    Assemble,
}

impl Part {
    const ALL: [Part; 11] = [
        Part::Head,
        Part::Held,
        Part::Tree,
        Part::LsTree,
        Part::Worktree,
        Part::GitStatus,
        Part::Compare,
        Part::HashObject,
        Part::Merge,
        Part::Seeds,
        Part::Assemble,
    ];

    fn name(self) -> &'static str {
        match self {
            Part::Head => "head",
            Part::Held => "held",
            Part::Tree => "tree",
            Part::LsTree => "ls-tree",
            Part::Worktree => "worktree",
            Part::GitStatus => "git status",
            Part::Compare => "compare",
            Part::HashObject => "hash-object",
            Part::Merge => "merge",
            Part::Seeds => "seeds",
            Part::Assemble => "assemble",
        }
    }

    fn sum(self) -> &'static AtomicU64 {
        &LISTING_PARTS[self as usize]
    }
}

/// Each listing part's wall time summed, indexed by [`Part`].
static LISTING_PARTS: [AtomicU64; 11] = [const { AtomicU64::new(0) }; 11];

/// `work`, its time added to the listing's `part` when the clock is on.
pub(crate) fn part<T>(part: Part, work: impl FnOnce() -> T) -> T {
    if !on() {
        return work();
    }
    summed(part.sum(), work)
}

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

/// `work`, timed as the sequential stage `name`.
pub(crate) fn timed<T>(name: &'static str, work: impl FnOnce() -> T) -> T {
    let stage = start(name);
    let done = work();
    stage.end();
    done
}

/// A sequential stage, started now; [`Stage::end`] writes its line.
pub(crate) struct Stage(Option<(&'static str, Instant)>);

pub(crate) fn start(name: &'static str) -> Stage {
    Stage(on().then(|| (name, Instant::now())))
}

/// The listing, started now with its parts zeroed, so time a part took
/// outside a listing, or in one that stopped short, is not printed as this one's.
/// The parts are zeroed with the clock off too: eleven stores, so the tests pin it.
pub(crate) fn start_listing(name: &'static str) -> Stage {
    for part in Part::ALL {
        part.sum().store(0, Ordering::Relaxed);
    }
    start(name)
}

/// The walk, started now with its sums zeroed, so a run that stopped short leaves nothing in them.
pub(crate) fn start_walk(name: &'static str) -> Stage {
    if on() {
        for sum in [&READ, &PARSE, &RESOLVE] {
            sum.store(0, Ordering::Relaxed);
        }
    }
    start(name)
}

impl Stage {
    pub(crate) fn end(self) {
        if let Some((name, started)) = self.0 {
            eprintln!("variance stage {name}: {}{}", seconds(started.elapsed()), peak());
        }
    }

    /// The listing's end: its wall time, with the time of each of its parts that ran.
    pub(crate) fn end_listing(self) {
        if let Some((name, started)) = self.0 {
            eprintln!("variance stage {name}: {}{}{}", seconds(started.elapsed()), peak(), listing_parts());
        }
    }

    /// The walk's end: its wall time, with the summed thread times of what overlapped in it, which it resets.
    pub(crate) fn end_walk(self) {
        if let Some((name, started)) = self.0 {
            let take = |sum: &AtomicU64| Duration::from_nanos(sum.swap(0, Ordering::Relaxed));
            let (parse, read_and_parse, resolve) = (take(&PARSE), take(&READ), take(&RESOLVE));
            let read = read_and_parse.saturating_sub(parse);
            eprintln!(
                "variance stage {name}: {}{} (thread time: read {}, parse {}, resolve {})",
                seconds(started.elapsed()),
                peak(),
                seconds(read),
                seconds(parse),
                seconds(resolve)
            );
        }
    }
}

/// ` (`, each listing part that ran with its time, and `)`, or nothing when none ran; it resets each part.
fn listing_parts() -> String {
    let parts: Vec<String> = Part::ALL
        .iter()
        .filter_map(|part| {
            let time = Duration::from_nanos(part.sum().swap(0, Ordering::Relaxed));
            (!time.is_zero()).then(|| format!("{} {}", part.name(), seconds(time)))
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

fn seconds(time: Duration) -> String {
    format!("{:.3} s", time.as_secs_f64())
}

/// `, peak` and the process's peak resident memory so far, or nothing where the platform does not give it.
fn peak() -> String {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: `getrusage` fills the struct it is handed and reads nothing else.
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0 {
            // SAFETY: a zero return means the struct was written.
            let maximum = unsafe { usage.assume_init() }.ru_maxrss as u64;
            // macOS counts bytes, Linux kibibytes.
            let bytes = if cfg!(target_os = "macos") { maximum } else { maximum * 1024 };
            return format!(", peak {:.2} GB", bytes as f64 / 1e9);
        }
    }
    String::new()
}

#[cfg(test)]
#[path = "stages_tests.rs"]
mod tests;
