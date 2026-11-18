//! Bounded acquisition of worktree files and committed Git blobs.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use oxc_allocator::AllocatorPool;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

use crate::git::Oid;
use crate::git_store::Objects;
use crate::source_read::SourceRead;

#[path = "acquire_timings.rs"]
mod timings;

#[path = "acquire_open.rs"]
mod opening;
use opening::{open, open_all, Opened};

/// What became of a file's bytes. `Declined` is a refusal the bytes decide —
/// over the size this scan opens, or not UTF-8 — so the record may name them
/// and is kept until they change. `Failed` is one they do not decide, and the
/// file is tried again; so is a refusal reached through a symbolic link, whose
/// object names the path the link holds and not the bytes behind it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Parsed,
    Declined,
    Failed,
}

impl Outcome {
    pub(crate) fn parsed(self) -> bool {
        self == Outcome::Parsed
    }
}

pub(crate) type Answer = (SourceRead, String, Outcome);
/// Acquisition's identity evidence, separate from whether it parsed blob bytes.
#[derive(Clone, Copy)]
pub(crate) enum Origin {
    ReadDigest,
    ParsedBlob,
    DeclinedBlob(Oid),
}

impl Origin {
    pub(crate) fn parsed_blob(self) -> bool { matches!(self, Self::ParsedBlob) }

    pub(crate) fn identity(self, oid: Option<&Oid>, digest: &str) -> String {
        match self {
            Self::DeclinedBlob(oid) => crate::git::spell(&oid),
            Self::ParsedBlob => oid.map(crate::git::spell).unwrap_or_else(|| digest.to_owned()),
            Self::ReadDigest => digest.to_owned(),
        }
    }
}

type Named = (Answer, Origin);

/// Worktree opens peak before the machine's core count on APFS.
const READERS: usize = 6;
/// Parsing overlaps six readers; using every core here oversubscribes the scan.
const PARSERS: usize = 4;
/// Enough files to keep the readers busy while bounding held source bytes.
const CHUNK: usize = 2048;
/// The largest file a read opens when its caller names no limit.
// FIXME: `LARGEST_FILE` in `scan.ts` is the same number, and a change to it
// bumps `VERSION` in `reuse.ts` so that no index keeps what the old limit
// declined. A change made only here moves the limit without that bump.
pub(crate) const LARGEST_FILE: u32 = 1024 * 1024;

/// A tree's permitted Git store, opened once when an indexed read needs it.
pub(crate) struct TreeObjects {
    held: Mutex<Option<Option<Arc<Objects>>>>,
    blobs: bool,
}

impl Default for TreeObjects {
    fn default() -> Self {
        Self { held: Mutex::default(), blobs: true }
    }
}

impl TreeObjects {
    /// An explicit worktree read, whose scans never open the object store.
    pub(crate) fn worktree() -> Self {
        Self { held: Mutex::new(Some(None)), blobs: false }
    }

    /// Whether this tree permits blob reads, independently of store availability.
    pub(crate) fn allows_blobs(&self) -> bool {
        self.blobs
    }

    /// The same cached store for source and configuration acquisition.
    pub(crate) fn objects_now(&self, root: &Path) -> Option<Arc<Objects>> {
        let mut held = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        held.get_or_insert_with(|| Objects::open(root).map(Arc::new)).clone()
    }


}

/// Read indexed `files` out of `objects` by `oids`, and unnamed files from
/// the worktree. Without a store every file is read from the worktree.
/// Each answer says whether its bytes are the blob its id names; an indexed
/// blob the store cannot read is a failed read.
#[allow(clippy::too_many_arguments, reason = "one read's whole request")]
pub(crate) fn read_git(
    objects: Option<&Objects>,
    root: String,
    files: Vec<String>,
    oids: Vec<Option<Oid>>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
) -> (Vec<Answer>, Vec<bool>) {
    let (read, origins) = read_git_origin(objects, root, files, oids, largest_file, digests, readers, symbols);
    (read, origins.into_iter().map(Origin::parsed_blob).collect())
}

#[allow(clippy::too_many_arguments, reason = "one read's whole request")]
fn read_git_origin(
    objects: Option<&Objects>, root: String, files: Vec<String>, oids: Vec<Option<Oid>>,
    largest_file: Option<u32>, digests: Option<bool>, readers: Option<u32>, symbols: bool,
) -> (Vec<Answer>, Vec<Origin>) {
    read_disk(root, files, &oids, largest_file, digests, readers, symbols, None, objects).0.into_iter().unzip()
}

/// Read content before looking its proven identity up in the native parse layers.
#[allow(clippy::too_many_arguments, reason = "one read's whole request")]
pub(crate) fn read_git_kept(
    objects: Option<&Objects>, root: String, files: Vec<String>, oids: Vec<Option<Oid>>,
    largest_file: Option<u32>, digests: Option<bool>, readers: Option<u32>, symbols: bool,
    kept: &dyn Fn(&str, &str) -> Option<SourceRead>,
    vouched: Option<&[bool]>,
) -> (Vec<Answer>, Vec<Origin>, Vec<bool>) {
    if objects.is_none() {
        let (rows, hits) = read_disk(root, files, &oids, largest_file, digests, readers, symbols, Some(kept), None);
        let (read, named) = rows.into_iter().unzip();
        return (read, named, hits);
    }
    if oids.iter().all(Option::is_some) && vouched.is_none_or(|rows| rows.iter().all(|vouched| *vouched)) {
        let (rows, hits) = read_disk(root, files, &oids, largest_file, digests, readers, symbols, Some(kept), objects);
        let (read, named) = rows.into_iter().unzip();
        return (read, named, hits);
    }
    let mut rows: Vec<Option<(Answer, Origin, bool)>> = (0..files.len()).map(|_| None).collect();
    let (mut tracked, mut ids, mut tracked_at) = (Vec::new(), Vec::new(), Vec::new());
    let (mut untracked, mut untracked_oids, mut untracked_at) = (Vec::new(), Vec::new(), Vec::new());
    for (at, (file, oid)) in files.into_iter().zip(oids).enumerate() {
        if oid.is_some() && vouched.is_none_or(|rows| rows.get(at).copied().unwrap_or(false)) {
            tracked.push(file); ids.push(oid); tracked_at.push(at);
        } else { untracked.push(file); untracked_oids.push(oid); untracked_at.push(at); }
    }
    if crate::timings::enabled() && !untracked.is_empty() {
        eprintln!("sense Git acquisition: {} vouched blobs; {} changed, untracked or symbolic worktree reads", tracked.len(), untracked.len());
    }
    if !tracked.is_empty() {
        let (read, hits) = read_disk(root.clone(), tracked, &ids, largest_file, digests, readers, symbols, Some(kept), objects);
        for ((at, (read, named)), hit) in tracked_at.into_iter().zip(read).zip(hits) { rows[at] = Some((read, named, hit)); }
    }
    let (read, hits) = read_disk(root, untracked, &untracked_oids, largest_file, digests, readers, symbols, Some(kept), None);
    for ((at, (read, named)), hit) in untracked_at.into_iter().zip(read).zip(hits) { rows[at] = Some((read, named, hit)); }
    let (mut read, mut named, mut hits) = (Vec::new(), Vec::new(), Vec::new());
    for row in rows {
        let (answer, blob, hit) = row.expect("every acquired file has one answer");
        read.push(answer); named.push(blob); hits.push(hit);
    }
    (read, named, hits)
}

pub(crate) fn read_all(
    root: String,
    files: Vec<String>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
) -> Vec<Answer> {
    let (read, _) = read_disk(root, files, &[], largest_file, digests, readers, symbols, None, None);
    read.into_iter().map(|(answer, _)| answer).collect()
}

/// The threads that open `files` worktree files at once: `readers`, or
/// `READERS`, and never more than there are files. The disk reader and the
/// native search both open their files in it, because past a few threads at
/// once each `open` costs the kernel more (journal 0065).
pub(crate) fn opening_pool(readers: Option<u32>, files: usize) -> Result<ThreadPool, ThreadPoolBuildError> {
    ThreadPoolBuilder::new()
        .num_threads(readers.map_or(READERS, |count| count as usize).min(files.max(1)))
        .build()
}

/// Acquire, bound, reuse and parse one ordered batch from its selected source.
fn read_disk(
    root: String,
    files: Vec<String>,
    oids: &[Option<Oid>],
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
    kept: Option<&dyn Fn(&str, &str) -> Option<SourceRead>>,
    packed: Option<&Objects>,
) -> (Vec<Named>, Vec<bool>) {
    let mut timings = timings::Batch::new(packed.is_none(), true);
    let largest = u64::from(largest_file.unwrap_or(LARGEST_FILE));
    let wanted = digests.unwrap_or(false);
    let at = Path::new(&root);
    let parsing = ThreadPoolBuilder::new().num_threads(PARSERS.min(files.len().max(1))).build();
    let arenas = AllocatorPool::new(parsing.as_ref().map_or(1, ThreadPool::current_num_threads));
    let parse = |held| match &parsing {
        Ok(pool) => pool.install(|| parse_all(held, &arenas, symbols)),
        Err(_) => parse_all(held, &arenas, symbols),
    };
    let opening = opening_pool(readers, files.len());
    let mut read = Vec::with_capacity(files.len());
    let mut hits = Vec::with_capacity(files.len());
    let mut chunks = (0..files.len()).step_by(CHUNK).map(|from| {
        let to = (from + CHUNK).min(files.len());
        (&files[from..to], oids.get(from..to).unwrap_or(&[]))
    });
    let Some((first, named)) = chunks.next() else {
        return (read, hits);
    };

    let (mut held, elapsed) = timings.measure(|| open_all(at, first, named, largest, wanted, &opening, packed));
    timings.opened(elapsed, &held);
    let mut previous_oids = named;
    for (next, named) in chunks {
        hits.extend(reuse_opened(&mut held, previous_oids, kept));
        let ((parsed, parse_time), (fresh, open_time)) = rayon::join(
            || timings.measure(|| parse(held)),
            || timings.measure(|| open_all(at, next, named, largest, wanted, &opening, packed)),
        );
        timings.parsed(parse_time);
        timings.opened(open_time, &fresh);
        read.extend(parsed);
        held = fresh;
        previous_oids = named;
    }
    hits.extend(reuse_opened(&mut held, previous_oids, kept));
    let (parsed, elapsed) = timings.measure(|| parse(held));
    timings.parsed(elapsed);
    read.extend(parsed);
    timings.report(&read, Some(&hits));
    (read, hits)
}

fn reuse_opened(
    opened: &mut [(&str, Opened, String, bool)], oids: &[Option<Oid>],
    kept: Option<&dyn Fn(&str, &str) -> Option<SourceRead>>,
) -> Vec<bool> {
    let Some(kept) = kept else { return vec![false; opened.len()] };
    opened.iter_mut().enumerate().map(|(at, (file, opened, digest, named))| {
        if digest.is_empty() || !matches!(opened, Opened::Source(_)) { return false }
        let identity = if *named { oids.get(at).and_then(Option::as_ref).map(crate::git::spell) } else { None };
        let Some(read) = kept(identity.as_deref().unwrap_or(digest), file) else { return false };
        *opened = Opened::Settled(read, Outcome::Parsed);
        true
    }).collect()
}

fn parse_all(
    opened: Vec<(&str, Opened, String, bool)>,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Vec<Named> {
    opened.into_par_iter().map(|row| parse_one(row, arenas, symbols)).collect()
}

fn parse_one((file, held, digest, named): (&str, Opened, String, bool), arenas: &AllocatorPool, symbols: bool) -> Named {
    let origin = if named { Origin::ParsedBlob } else { Origin::ReadDigest };
    match held {
        Opened::DeclinedBlob(read, oid) => ((read, digest, Outcome::Declined), Origin::DeclinedBlob(oid)),
        Opened::Settled(read, outcome) => ((read, digest, outcome), origin),
        Opened::Source(source) => ((SourceRead::read(file, &source, &arenas.get(), symbols), digest, Outcome::Parsed), origin),
    }
}

fn too_large(file: &str, size: u64, largest: u64) -> String {
    format!(
        "{file} is {size} bytes, over the {largest} this scan opens: parsing it \
         costs about fifty times that in memory, and it is almost certainly built \
         output."
    )
}

/// Whether `unknown` is the native size refusal for `file`.
// TODO: a record carries a decline for size only in its reason's words; a field
// for it would let a keep ask without matching them.
pub(crate) fn declined_for_size(file: &str, unknown: &str) -> bool {
    unknown.strip_prefix(file).is_some_and(|rest| rest.starts_with(" is "))
        && unknown.contains(" this scan opens: parsing it costs about fifty times that in memory")
        && unknown.contains("almost certainly built output.")
}

/// Whether `file` is still over `largest` as it is checked out, through any
/// link. A decline is decided on these bytes and kept by Git's object name,
/// which under a clean filter — `core.autocrlf`, LFS — names other bytes.
pub(crate) fn still_too_large(root: &Path, file: &str, largest: u64) -> bool {
    fs::metadata(root.join(file)).is_ok_and(|held| held.len() > largest)
}

#[cfg(test)]
#[path = "acquire_tests.rs"]
mod tests;
