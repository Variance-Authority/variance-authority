//! The stage clock: with `VARIANCE_AUTHORITY_INDEX_STAGES` set, each stage of
//! a native index run writes one line to stderr, its wall time and the
//! process's peak resident memory at its end; unset, nothing is timed.
//!
//! A sequential stage (listing, walk, records, encode, write) is wall time, so
//! those lines sum to the run's. Read, parse and resolve overlap inside the
//! walk, on every core, so each is the thread time summed over the files, and
//! the walk's line carries them. It also carries the wall time it waited on the
//! language indexes a wave builds before it resolves, which no thread time
//! names. The listing's line names the wall time of each
//! of its parts.
//! The sums are the process's: a start drops what they held before it, but two
//! stages running at once in one process would share them, and the index runs
//! one update at a time.

// compass: variance-authority.reach.source-index

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Whether the variable is set: read once, so a stage that is not timed costs one load.
pub(crate) fn on() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("VARIANCE_AUTHORITY_INDEX_STAGES").is_some_and(|value| !value.is_empty() && value != "0"))
}

/// A sum the clock keeps, indexed into [`SUMS`]: the walk's thread times, then
/// the listing's parts. Each stage's [`Sums`] says which are its own.
#[derive(Clone, Copy)]
pub(crate) enum Sum {
    Read,
    Parse,
    Resolve,
    Index,
    Head,
    Held,
    Tree,
    LsTree,
    Worktree,
    GitStatus,
    Compare,
    Overlay,
    HashObject,
    Merge,
    Seeds,
    Assemble,
}

const COUNT: usize = Sum::Assemble as usize + 1;

type Table = [AtomicU64; COUNT];

/// Every sum, in nanoseconds. They are the process's: a caller timing at the
/// same time adds to them, and a stage's start zeroes only what came before it.
static SUMS: Table = [const { AtomicU64::new(0) }; COUNT];

/// One sum on a stage's line: its label, and the sum whose time inside it is taken out.
pub(crate) struct Shown {
    label: &'static str,
    sum: Sum,
    less: Option<Sum>,
}

/// What a stage's line names after its time: its own sums, opened by `lead`,
/// then the wall times in `wall`, opened by `; wall: `.
/// With `zeros`, a sum that stayed zero prints too; without, it is left out,
/// and a line with none left adds nothing.
pub(crate) struct Sums {
    lead: &'static str,
    shown: &'static [Shown],
    wall: &'static [Shown],
    zeros: bool,
}

const fn shown(label: &'static str, sum: Sum) -> Shown {
    Shown { label, sum, less: None }
}

/// A stage that names no sums.
pub(crate) const NONE: Sums = Sums { lead: "", shown: &[], wall: &[], zeros: false };

/// The walk: read, parse and resolve overlap on every core, so each is thread
/// time summed over the files. Reading a file parses it, so `read` is the
/// read sum less the parse sum. `index` is the wall time the waves waited on
/// the language indexes they build before resolving; what those read is in
/// `read` and `parse` too.
pub(crate) const WALK: Sums = Sums {
    lead: "thread time: ",
    shown: &[Shown { label: "read", sum: Sum::Read, less: Some(Sum::Parse) }, shown("parse", Sum::Parse), shown("resolve", Sum::Resolve)],
    wall: &[shown("index", Sum::Index)],
    zeros: true,
};

/// The listing: each part's wall time, in this order. `tree` and `worktree`
/// run at once and `overlay` holds `hash-object`, so the parts do not sum to
/// the listing's line, and work no part names is in the line alone.
pub(crate) const LISTING: Sums = Sums {
    lead: "",
    shown: &[
        shown("head", Sum::Head),
        shown("held", Sum::Held),
        shown("tree", Sum::Tree),
        shown("ls-tree", Sum::LsTree),
        shown("worktree", Sum::Worktree),
        shown("git status", Sum::GitStatus),
        shown("compare", Sum::Compare),
        shown("overlay", Sum::Overlay),
        shown("hash-object", Sum::HashObject),
        shown("merge", Sum::Merge),
        shown("seeds", Sum::Seeds),
        shown("assemble", Sum::Assemble),
    ],
    wall: &[],
    zeros: false,
};

impl Sums {
    /// Each sum this stage owns: the ones it shows and the ones it takes out of them.
    fn owned(&self) -> impl Iterator<Item = Sum> + '_ {
        self.shown.iter().chain(self.wall).flat_map(|shown| std::iter::once(shown.sum).chain(shown.less))
    }
}

/// `sums`' own entries of `table` set to zero.
fn reset(table: &Table, sums: &Sums) {
    for sum in sums.owned() {
        table[sum as usize].store(0, Ordering::Relaxed);
    }
}

/// ` (`, `sums`' lead and each of its sums from `table` with its time, and `)`;
/// nothing when it shows none. It resets each sum it reads.
fn taken(table: &Table, sums: &Sums) -> String {
    let mut nanos = [0u64; COUNT];
    for sum in sums.owned() {
        nanos[sum as usize] += table[sum as usize].swap(0, Ordering::Relaxed);
    }
    let named = |group: &[Shown]| -> Vec<String> {
        group
            .iter()
            .filter_map(|shown| {
                let time = nanos[shown.sum as usize].saturating_sub(shown.less.map_or(0, |less| nanos[less as usize]));
                (sums.zeros || time != 0).then(|| format!("{} {}", shown.label, seconds(Duration::from_nanos(time))))
            })
            .collect()
    };
    let (threads, wall) = (named(sums.shown), named(sums.wall));
    let mut groups: Vec<String> = Vec::new();
    if !threads.is_empty() {
        groups.push(format!("{}{}", sums.lead, threads.join(", ")));
    }
    if !wall.is_empty() {
        groups.push(format!("wall: {}", wall.join(", ")));
    }
    if groups.is_empty() {
        String::new()
    } else {
        format!(" ({})", groups.join("; "))
    }
}

/// A part being timed, started now; dropped, it adds its time to its sum.
pub(crate) struct Part(Option<(Sum, Instant)>);

/// The part `sum`, timed from now when the clock is on.
pub(crate) fn part(sum: Sum) -> Part {
    Part(on().then(|| (sum, Instant::now())))
}

impl Part {
    /// The part's end, before the scope's.
    pub(crate) fn end(self) {}
}

impl Drop for Part {
    fn drop(&mut self) {
        if let Some((sum, started)) = self.0 {
            SUMS[sum as usize].fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);
        }
    }
}

/// `work`, its time added to `sum` when the clock is on.
pub(crate) fn summed<T>(sum: Sum, work: impl FnOnce() -> T) -> T {
    let _part = part(sum);
    work()
}

/// `work`, timed as the sequential stage `name`, which names no sums.
pub(crate) fn timed<T>(name: &'static str, work: impl FnOnce() -> T) -> T {
    let stage = start(name, &NONE);
    let done = work();
    stage.end();
    done
}

/// A sequential stage, started now; [`Stage::end`] writes its line.
pub(crate) struct Stage(Option<(&'static str, Instant, &'static Sums)>);

/// The stage `name`, started now when the clock is on, with its own `sums`
/// zeroed, so time they took before it, or in a run that stopped short, is not
/// printed as its own.
pub(crate) fn start(name: &'static str, sums: &'static Sums) -> Stage {
    Stage(on().then(|| {
        reset(&SUMS, sums);
        (name, Instant::now(), sums)
    }))
}

impl Stage {
    /// Its line: its wall time, the peak so far, and its own sums, which it resets.
    pub(crate) fn end(self) {
        if let Some((name, started, sums)) = self.0 {
            eprintln!("variance stage {name}: {}{}{}", seconds(started.elapsed()), peak(), taken(&SUMS, sums));
        }
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
