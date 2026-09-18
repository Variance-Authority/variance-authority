//! Every file at once, across every core, as five columns.
//!
//! This is the part JavaScript cannot have. One file's read-parse-extract is a
//! few hundred microseconds and perfectly independent of the next one's, so the
//! work is embarrassingly parallel and the single-threaded scan spends its wall
//! clock waiting: a profile of a cold scan is 43% idle on a sixteen-core
//! machine. A worker pool does not fix that either, because the results have to
//! come back — at about fifty microseconds of `postMessage` per module against
//! two hundred of work, the main thread becomes the ceiling at around three
//! times. Here the results do not come back one at a time. Rayon fans the batch
//! over the pool, each file's arena is allocated and dropped inside its own
//! task, and the boundary is crossed once, with columns.
//!
//! The order of the answer is the order of the question, because `par_iter`
//! collects positionally. Determinism costs nothing and is not bought with
//! serial execution.

use std::fs;
use std::io::Read as _;
use std::path::Path;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use oxc_allocator::AllocatorPool;
use napi_derive::napi;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

use crate::digest;
use crate::read::{read_module, Kind, Read};

/// What a batch of files said, in columns rather than in objects.
///
/// One entry per file in `counts`, `digests` and `unknown`, in the order the
/// files were asked about; `counts[i]` requests belonging to file `i` follow the
/// previous file's in `values` and `kinds`. Four hundred thousand edges cross as
/// two arrays and a prefix rather than as four hundred thousand objects.
#[napi(object)]
pub struct ReadBatch {
    /// How many requests each file contributed, in file order.
    pub counts: Uint32Array,
    /// Each file's content digest, or `""` when it was not asked for or the file
    /// could not be read.
    pub digests: Vec<String>,
    /// Why a file's requests are not the whole set, or `""` when they are.
    pub unknown: Vec<String>,
    /// Every request's specifier, concatenated in file order.
    pub values: Vec<String>,
    /// Every request's kind, in the same order, as an index into [`kinds`].
    ///
    /// A byte rather than a word: there are five kinds and there are as many
    /// requests as there are edges, and five strings interned once on the
    /// JavaScript side say the same thing as four hundred thousand copies.
    pub kinds: Buffer,
}

/// The message `scan.ts` gives a file it declines to open, given here as there.
///
/// Reproduced rather than shared because it is an answer, and an answer that
/// differs between the two implementations is the one thing the differential
/// tests exist to catch.
fn too_large(file: &str, size: u64, largest: u64) -> String {
    format!(
        "{file} is {size} bytes, over the {largest} this scan opens: parsing it \
         costs about fifty times that in memory, and it is almost certainly built \
         output. Raise `largestFile` to read it anyway."
    )
}

/// Read, parse and extract every one of `files`, in parallel, under `root`.
///
/// Paths are repository-relative and come back untouched — this side never
/// invents a path. Resolution is not here: an unresolved specifier is still a
/// specifier, and what a specifier resolves to is the caller's question until
/// the resolver moves too.
#[napi]
pub fn read_batch(
    root: String,
    files: Vec<String>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
) -> ReadBatch {
    let largest = u64::from(largest_file.unwrap_or(1024 * 1024));
    let wanted = digests.unwrap_or(false);
    let at = Path::new(&root);

    // One arena per thread rather than one per file. A fresh `Allocator` maps
    // memory and drops it again for every file in the repository; the pool hands
    // a thread the arena the last file on that thread just finished with, reset.
    let arenas = AllocatorPool::new(rayon::current_num_threads());

    let opening = ThreadPoolBuilder::new()
        .num_threads(readers.map_or(READERS, |count| count as usize).min(files.len().max(1)))
        .build();

    let mut read: Vec<(Read, String)> = Vec::with_capacity(files.len());
    let mut chunks = files.chunks(CHUNK);
    let Some(first) = chunks.next() else { return columns(read) };

    // Open the next chunk while the last one parses. The two stages want
    // different widths, so neither is allowed to set the other's: the reads run
    // in `opening`, the parses on the global pool, and the pipeline holds one
    // chunk of source bytes rather than the repository's.
    let mut held = open_all(at, first, largest, wanted, &opening);
    for next in chunks {
        let (parsed, fresh) = rayon::join(
            || parse_all(held, &arenas),
            || open_all(at, next, largest, wanted, &opening),
        );
        read.extend(parsed);
        held = fresh;
    }
    read.extend(parse_all(held, &arenas));

    columns(read)
}

/// How many threads may be inside the filesystem at once.
///
/// Not the core count, and the difference is the measurement this whole stage
/// turns on. Opening material-ui's 27,744 modules costs 12.8 µs of kernel time
/// per file on one thread and 184 µs on sixteen: the syscalls do not scale, they
/// queue, and the batch that fans reads to every core finishes in 420 ms where
/// the same batch on six threads finishes in 154. Throughput saturates around
/// three and collapses past eight. Parsing has no such ceiling, which is why it
/// is a separate stage rather than a wider one.
const READERS: usize = 6;

/// Files per pipeline step — enough that the reader pool is never idle waiting
/// for a step to end, few enough that their bytes are megabytes and not the
/// repository. Measured over material-ui: 2,048 finishes in 201 ms and 128 in
/// 349, because a step short enough to pipeline finely is also short enough that
/// six readers spend it starting and stopping.
const CHUNK: usize = 2048;

/// A file once it has been opened: its bytes, or the answer opening it settled.
enum Opened {
    Source(String),
    Settled(Read),
}

fn open_all<'a>(
    root: &Path,
    files: &'a [String],
    largest: u64,
    digests: bool,
    opening: &Result<ThreadPool, ThreadPoolBuildError>,
) -> Vec<(&'a str, Opened, String)> {
    let work = || -> Vec<(&'a str, Opened, String)> {
        files.par_iter().map(|file| open(root, file, largest, digests)).collect()
    };

    match opening {
        Ok(pool) => pool.install(work),
        // A pool that will not build is a machine under a thread limit, not a
        // reason to answer nothing: the global pool reads them instead.
        Err(_) => work(),
    }
}

fn parse_all(opened: Vec<(&str, Opened, String)>, arenas: &AllocatorPool) -> Vec<(Read, String)> {
    opened
        .into_par_iter()
        .map(|(file, held, digest)| match held {
            Opened::Settled(read) => (read, digest),
            Opened::Source(source) => (read_module(file, &source, &arenas.get()), digest),
        })
        .collect()
}

/// Every answer, as the columns that cross the boundary.
fn columns(read: Vec<(Read, String)>) -> ReadBatch {
    let total = read.iter().map(|(held, _)| held.requests.len()).sum();
    let mut counts = Vec::with_capacity(read.len());
    let mut unknown = Vec::with_capacity(read.len());
    let mut held_digests = Vec::with_capacity(read.len());
    let mut values = Vec::with_capacity(total);
    let mut kinds = Vec::with_capacity(total);

    for (held, digest) in read {
        counts.push(held.requests.len() as u32);
        unknown.push(held.unknown.unwrap_or_default());
        held_digests.push(digest);
        for request in held.requests {
            values.push(request.value);
            kinds.push(request.kind.code());
        }
    }

    ReadBatch {
        counts: Uint32Array::new(counts),
        digests: held_digests,
        unknown,
        values,
        kinds: kinds.into(),
    }
}

/// The kind names, indexed by the codes `ReadBatch.kinds` carries.
#[napi]
pub fn kinds() -> Vec<String> {
    Kind::ALL.iter().map(|kind| kind.as_str().to_owned()).collect()
}

/// One file's bytes, or the reason they are not available.
///
/// A file that is gone, unreadable or too large is a *partial* answer with its
/// reason attached, never an empty one — an empty one claims the file depends on
/// nothing, which narrows a selection on no evidence.
fn open<'a>(root: &Path, file: &'a str, largest: u64, digests: bool) -> (&'a str, Opened, String) {
    let absolute = root.join(file);
    let settled = |unknown: String| {
        (file, Opened::Settled(Read { requests: Vec::new(), unknown: Some(unknown) }), String::new())
    };

    // One descriptor, not one pathname and then another. The size is asked of the
    // open file rather than of the path, so the bytes measured are the bytes read
    // — a `stat` and a later `read` are two answers about a file that may have
    // moved between them. It is not faster: measured over material-ui, a `stat`
    // followed by an `open` costs what a single `open` costs, because the second
    // lookup finds the vnode the first one just cached.
    let mut held = match fs::File::open(&absolute) {
        Ok(held) => held,
        Err(error) => return settled(format!("{file} could not be read: {error}")),
    };

    // Asked before the file is parsed, because a parse cannot be given back: the
    // arena is native and costs its fifty times the moment it is allocated.
    let size = match held.metadata() {
        Ok(held) => held.len(),
        Err(error) => return settled(format!("{file} could not be read: {error}")),
    };
    if size > largest {
        return settled(too_large(file, size, largest));
    }

    let mut source = String::with_capacity(size as usize);
    if let Err(error) = held.read_to_string(&mut source) {
        return settled(format!("{file} could not be read: {error}"));
    }

    let digest = if digests { digest::of_string(&source) } else { String::new() };

    (file, Opened::Source(source), digest)
}

/// Kept honest: the words crossing the boundary are the words `read.ts` reads.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_kinds_the_way_the_oracle_does() {
        assert_eq!(kinds(), ["imports", "reexports", "dynamic", "type"]);
    }

    #[test]
    fn a_code_indexes_the_name() {
        for (code, kind) in Kind::ALL.iter().enumerate() {
            assert_eq!(kind.code() as usize, code);
        }
    }
}
