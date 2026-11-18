//! Bounded acquisition of worktree files and committed Git blobs.

use std::fs;
use std::io::{ErrorKind, Read as _};
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use gix_hash::ObjectId;

use oxc_allocator::AllocatorPool;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

use crate::digest;
use crate::git::Oid;
use crate::git_store::{Objects, Reader, STORE_CROSSOVER};
use crate::read::Read;
use crate::read_any::read_file;

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

pub(crate) type Answer = (Read, String, Outcome);
/// An answer, and whether the bytes it parsed are the blob its request named:
/// read out of Git's object store, or off the disk and hashed to that name.
type Named = (Answer, bool);

/// Worktree opens peak before the machine's core count on APFS.
const READERS: usize = 6;
/// Enough files to keep the readers busy while bounding held source bytes.
const CHUNK: usize = 2048;
/// The largest file a read opens when its caller names no limit.
// FIXME: `LARGEST_FILE` in `scan.ts` is the same number, and a change to it
// bumps `VERSION` in `reuse.ts` so that no index keeps what the old limit
// declined. A change made only here moves the limit without that bump.
pub(crate) const LARGEST_FILE: u32 = 1024 * 1024;

/// The object store a tree's scans read from, opened once.
///
/// Opening the store asks git two questions, about 15 ms on Kibana, and a blob
/// out of an open store saves about 5 us against opening its file on a warm
/// page cache: the open pays after about `STORE_CROSSOVER` files, the line
/// `ask grep` opens its store at (`docs/performance.md`). So the store opens
/// on the read, a wave or a slice of one, that brings the files the tree's
/// scans have read to it, and every read after comes from it. The tree holds
/// it, because a scan from the JavaScript side crosses once per wave. It opens
/// under the root of the read that reaches the crossover, which is the tree's.
#[derive(Default)]
pub(crate) struct TreeObjects(Mutex<(usize, Option<Option<Arc<Objects>>>)>);

impl TreeObjects {
    /// A store that never opens: every read comes off the disk.
    pub(crate) fn disk() -> Self {
        TreeObjects(Mutex::new((0, Some(None))))
    }

    /// The store a read of `files` under `root` comes from, or `None` for the
    /// disk; a store that cannot open is not asked again.
    pub(crate) fn objects(&self, root: &Path, files: usize) -> Option<Arc<Objects>> {
        let mut held = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let (read, objects) = &mut *held;
        *read += files;
        if objects.is_none() && *read >= STORE_CROSSOVER {
            *objects = Some(Objects::open(root).map(Arc::new));
        }
        objects.clone()?
    }
}

/// Read `files` out of `objects` by `oids`, each file's id or `None` for an
/// untracked one, and off the disk wherever the store answers nothing; with
/// each answer, whether its bytes are the blob its id names. No store reads
/// every file off the disk.
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
    // Without a store the chunked disk pipeline overlaps the next open with the
    // current parse. Both paths give the same answers.
    let Some(objects) = objects else {
        return read_disk(root, files, &oids, largest_file, digests, readers, symbols).into_iter().unzip();
    };
    let largest = u64::from(largest_file.unwrap_or(LARGEST_FILE));
    let wanted = digests.unwrap_or(false);
    let root = Path::new(&root);
    // A blob is decoded and parsed in memory, so the store path runs on every
    // core rather than at the disk reader's width: on Kibana (115,177 files)
    // the whole index took 6.4 s at six threads and 5.7 s at ten or more. The
    // few files the store does not hold open off the disk among them.
    let arenas = AllocatorPool::new(rayon::current_num_threads());
    files
        .par_iter()
        .zip(&oids)
        .map_init(
            || objects.reader(),
            |reader, (file, oid)| match oid {
                Some(oid) => read_blob(root, file, oid, reader, largest, wanted, &arenas, symbols),
                None => open_and_parse(root, file, None, largest, wanted, &arenas, symbols),
            },
        )
        .collect::<Vec<Named>>()
        .into_iter()
        .unzip()
}

#[allow(clippy::too_many_arguments, reason = "one read's whole request")]
fn read_blob(
    root: &Path,
    file: &str,
    oid: &Oid,
    reader: &mut Reader,
    largest: u64,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Named {
    let id = ObjectId::from_bytes_or_panic(oid);
    let Some(size) = reader.size(&id) else {
        return open_and_parse(root, file, Some(oid), largest, digests, arenas, symbols);
    };
    if size > largest {
        let unknown = Some(too_large(file, size, largest));
        return ((Read { unknown, ..Read::default() }, String::new(), Outcome::Declined), false);
    }
    // A pointer git-lfs smudged, or bytes that are not UTF-8, are answered by the
    // disk, which holds the content this scan reads or declines it by its bytes.
    let source = reader.blob(&id).and_then(|bytes| std::str::from_utf8(bytes).ok()).map(str::to_owned);
    match source {
        Some(source) => (parsed(file, source, digests, arenas, symbols), true),
        None => open_and_parse(root, file, Some(oid), largest, digests, arenas, symbols),
    }
}

fn open_and_parse(
    root: &Path,
    file: &str,
    oid: Option<&Oid>,
    largest: u64,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Named {
    let (_, opened, digest, named) = open(root, file, largest, digests, oid);
    match opened {
        Opened::Settled(read, outcome) => ((read, digest, outcome), false),
        Opened::Source(source) => (parsed(file, source, digests, arenas, symbols), named),
    }
}

fn parsed(
    file: &str,
    source: String,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Answer {
    let digest = if digests {
        digest::of_string(&source)
    } else {
        String::new()
    };
    (
        read_file(file, &source, &arenas.get(), symbols),
        digest,
        Outcome::Parsed,
    )
}

pub(crate) fn read_all(
    root: String,
    files: Vec<String>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
) -> Vec<Answer> {
    let read = read_disk(root, files, &[], largest_file, digests, readers, symbols);
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

/// Read `files` off the disk; `oids` is empty, or Git's name for each file.
fn read_disk(
    root: String,
    files: Vec<String>,
    oids: &[Option<Oid>],
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
) -> Vec<Named> {
    let largest = u64::from(largest_file.unwrap_or(LARGEST_FILE));
    let wanted = digests.unwrap_or(false);
    let at = Path::new(&root);
    let arenas = AllocatorPool::new(rayon::current_num_threads());
    let opening = opening_pool(readers, files.len());
    let mut read = Vec::with_capacity(files.len());
    let mut chunks = (0..files.len()).step_by(CHUNK).map(|from| {
        let to = (from + CHUNK).min(files.len());
        (&files[from..to], oids.get(from..to).unwrap_or(&[]))
    });
    let Some((first, named)) = chunks.next() else {
        return read;
    };

    let mut held = open_all(at, first, named, largest, wanted, &opening);
    for (next, named) in chunks {
        let (parsed, fresh) = rayon::join(
            || parse_all(held, &arenas, symbols),
            || open_all(at, next, named, largest, wanted, &opening),
        );
        read.extend(parsed);
        held = fresh;
    }
    read.extend(parse_all(held, &arenas, symbols));
    read
}

enum Opened {
    Source(String),
    Settled(Read, Outcome),
}

fn open_all<'a>(
    root: &Path,
    files: &'a [String],
    oids: &[Option<Oid>],
    largest: u64,
    digests: bool,
    opening: &Result<ThreadPool, ThreadPoolBuildError>,
) -> Vec<(&'a str, Opened, String, bool)> {
    let work = || {
        files
            .par_iter()
            .enumerate()
            .map(|(index, file)| open(root, file, largest, digests, oids.get(index).and_then(Option::as_ref)))
            .collect()
    };
    match opening {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }
}

// FIXME: parsing runs on the global rayon pool, which sizes itself from every
// core it can see — including efficiency cores, and without knowing that six
// readers are already running beside it under the `join` above. On an M4 Pro
// (10 performance, 4 efficiency) that is 6 + 14 runnable workers on 10 fast
// cores: a 306,694-file scan takes 10.9 s wall and 58.0 s user at the default
// width against 8.8 s and 48.9 s with the parser pool bounded to four. What it
// wants is a private pool per stage, sized from the performance-core count, not
// a global width shared with the readers. `READERS = 6` was measured against
// this same global pool and should be re-read in the same pass.
fn parse_all(
    opened: Vec<(&str, Opened, String, bool)>,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Vec<Named> {
    opened
        .into_par_iter()
        .map(|(file, held, digest, named)| match held {
            Opened::Settled(read, outcome) => ((read, digest, outcome), false),
            Opened::Source(source) => {
                ((read_file(file, &source, &arenas.get(), symbols), digest, Outcome::Parsed), named)
            }
        })
        .collect()
}

/// The file's text, its digest when `digests`, and whether it is the blob `oid` names.
fn open<'a>(
    root: &Path,
    file: &'a str,
    largest: u64,
    digests: bool,
    oid: Option<&Oid>,
) -> (&'a str, Opened, String, bool) {
    let settled = |unknown, outcome| {
        (
            file,
            Opened::Settled(
                Read {
                    unknown: Some(unknown),
                    ..Read::default()
                },
                outcome,
            ),
            String::new(),
            false,
        )
    };
    let failed = |error: std::io::Error| settled(format!("{file} could not be read: {error}"), Outcome::Failed);
    let mut held = match fs::File::open(root.join(file)) {
        Ok(held) => held,
        Err(error) => return failed(error),
    };
    let size = match held.metadata() {
        Ok(held) => held.len(),
        Err(error) => return failed(error),
    };
    // Asked only of a refusal, so a file that parses costs no second call: a
    // link's object is the path it holds, and would keep a refusal of the bytes
    // behind it after they change.
    let declined = || match fs::symlink_metadata(root.join(file)) {
        Ok(entry) if !entry.file_type().is_symlink() => Outcome::Declined,
        _ => Outcome::Failed,
    };
    if size > largest {
        return settled(too_large(file, size, largest), declined());
    }
    let mut source = String::with_capacity(size as usize);
    if let Err(error) = held.read_to_string(&mut source) {
        // Bytes that are not UTF-8 are refused by the same bytes every time.
        return match error.kind() {
            ErrorKind::InvalidData => {
                settled(format!("{file} is not UTF-8, so this scan does not parse it: {error}"), declined())
            }
            _ => failed(error),
        };
    }
    // Failed rather than declined: `git lfs pull` changes these bytes and not
    // the object name a decline is kept by, which is the pointer's either way.
    if crate::lfs::pointer(source.as_bytes()) {
        return settled(crate::lfs::checked_out(file), Outcome::Failed);
    }
    let digest = if digests {
        digest::of_string(&source)
    } else {
        String::new()
    };
    let named = oid.is_some_and(|oid| crate::parse_origin::names(oid, source.as_bytes()));
    (file, Opened::Source(source), digest, named)
}

fn too_large(file: &str, size: u64, largest: u64) -> String {
    format!(
        "{file} is {size} bytes, over the {largest} this scan opens: parsing it \
         costs about fifty times that in memory, and it is almost certainly built \
         output. Raise `largestFile` to read it anyway."
    )
}

/// Whether `unknown` is the reason `too_large` gives `file`. `record.ts` writes
/// the same words for the files it declines.
// TODO: a record carries a decline for size only in its reason's words; a field
// for it would let a keep ask without matching them.
pub(crate) fn declined_for_size(file: &str, unknown: &str) -> bool {
    unknown.strip_prefix(file).is_some_and(|rest| rest.starts_with(" is "))
        && unknown.contains(" this scan opens: parsing it costs about fifty times that in memory")
        && unknown.ends_with("Raise `largestFile` to read it anyway.")
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
