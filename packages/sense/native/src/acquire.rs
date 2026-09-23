//! Bounded acquisition of worktree files and committed Git blobs.

use std::fs;
use std::io::{BufRead, BufReader, Read as _, Write as _};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;

use oxc_allocator::AllocatorPool;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

use crate::digest;
use crate::git::{self, Oid};
use crate::read::{read_module, Read};

pub(crate) type Answer = (Read, String, bool);
type Numbered = (usize, Answer);
type Requested = (usize, String, Option<Oid>);

/// Worktree opens peak before the machine's core count on APFS.
const READERS: usize = 6;
/// Enough files to keep the readers busy while bounding held source bytes.
const CHUNK: usize = 2048;
/// How many files one `cat-file` process must answer to have been worth starting.
///
/// Starting one costs about 7 ms on this machine; reading a blob out of it
/// instead of opening the file saves about 53 us, because what a worktree read
/// costs is the descriptor rather than the bytes. The two divide to about a
/// hundred and thirty files, and the number is rounded up rather than down: a
/// bucket that only just clears the line saves nothing worth a process, while
/// one that misses it pays 7 ms for a wave a disk read would have finished.
const FILES_PER_PROCESS: usize = 160;

pub(crate) fn read_git(
    root: String,
    files: Vec<String>,
    oids: Vec<Option<Oid>>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    symbols: bool,
) -> Vec<Answer> {
    let largest = u64::from(largest_file.unwrap_or(1024 * 1024));
    let wanted = digests.unwrap_or(false);
    let count = files.len();
    // A wave too small to pay for one process reads from disk, where the chunked
    // pipeline overlaps the next open with the current parse. Both paths give the
    // same answers; this one only ever decides which is cheaper.
    if count < FILES_PER_PROCESS {
        return read_all(root, files, largest_file, digests, readers, symbols);
    }
    let width = readers
        .map_or(READERS, |value| value as usize)
        .min(count / FILES_PER_PROCESS);
    let arenas = AllocatorPool::new(width);
    let (send, receive) = mpsc::channel();
    let mut buckets: Vec<Vec<Requested>> = (0..width).map(|_| Vec::new()).collect();
    for (index, (file, oid)) in files.into_iter().zip(oids).enumerate() {
        buckets[index % width].push((index, file, oid));
    }

    std::thread::scope(|scope| {
        for bucket in buckets {
            let send = send.clone();
            let root = root.clone();
            let arenas = &arenas;
            scope.spawn(move || {
                for answer in read_git_bucket(&root, bucket, largest, wanted, arenas, symbols) {
                    let _ = send.send(answer);
                }
            });
        }
    });
    drop(send);
    ordered(count, receive)
}

fn read_git_bucket(
    root: &str,
    bucket: Vec<Requested>,
    largest: u64,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Vec<Numbered> {
    let tracked: Vec<String> = bucket
        .iter()
        .filter_map(|(_, _, oid)| oid.as_ref().map(git::hex))
        .collect();
    let mut child = if tracked.is_empty() {
        None
    } else {
        Command::new("git")
            .args(["cat-file", "--batch"])
            // Missing worktree hashes must reach the disk fallback, including
            // in promisor repositories where Git otherwise tries a fetch.
            .env("GIT_NO_LAZY_FETCH", "1")
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()
    };
    let mut reader = child
        .as_mut()
        .and_then(|held| held.stdout.take())
        .map(BufReader::new);
    if let Some(pipe) = child.as_mut().and_then(|held| held.stdin.take()) {
        std::thread::spawn(move || {
            let mut pipe = pipe;
            for oid in tracked {
                let _ = writeln!(pipe, "{oid}");
            }
        });
    }

    let root = Path::new(root);
    let mut answers = Vec::with_capacity(bucket.len());
    for (index, file, oid) in bucket {
        let answer = match (oid, reader.as_mut()) {
            (Some(_), Some(reader)) => {
                read_blob(root, &file, reader, largest, digests, arenas, symbols)
            }
            _ => open_and_parse(root, &file, largest, digests, arenas, symbols),
        };
        answers.push((index, answer));
    }
    if let Some(mut child) = child {
        let _ = child.wait();
    }
    answers
}

fn read_blob<R: BufRead>(
    root: &Path,
    file: &str,
    reader: &mut R,
    largest: u64,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Answer {
    let mut header = String::new();
    if reader.read_line(&mut header).is_err() || header.ends_with(" missing\n") {
        return open_and_parse(root, file, largest, digests, arenas, symbols);
    }
    let Some(size) = header
        .split_ascii_whitespace()
        .nth(2)
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return open_and_parse(root, file, largest, digests, arenas, symbols);
    };
    if size > largest {
        let copied = {
            let mut blob = (&mut *reader).take(size);
            std::io::copy(&mut blob, &mut std::io::sink())
        };
        let mut newline = [0];
        if !matches!(copied, Ok(read) if read == size) || reader.read_exact(&mut newline).is_err() {
            return open_and_parse(root, file, largest, digests, arenas, symbols);
        }
        return (
            Read {
                unknown: Some(too_large(file, size, largest)),
                ..Read::default()
            },
            String::new(),
            false,
        );
    }
    let mut bytes = vec![0; size as usize];
    if reader.read_exact(&mut bytes).is_err() {
        return open_and_parse(root, file, largest, digests, arenas, symbols);
    }
    let mut newline = [0];
    let _ = reader.read_exact(&mut newline);
    let Ok(source) = String::from_utf8(bytes) else {
        return open_and_parse(root, file, largest, digests, arenas, symbols);
    };
    parsed(file, source, digests, arenas, symbols)
}

fn open_and_parse(
    root: &Path,
    file: &str,
    largest: u64,
    digests: bool,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Answer {
    let (_, opened, digest) = open(root, file, largest, digests);
    match opened {
        Opened::Settled(read) => (read, digest, false),
        Opened::Source(source) => parsed(file, source, digests, arenas, symbols),
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
        read_module(file, &source, &arenas.get(), symbols),
        digest,
        true,
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
    let largest = u64::from(largest_file.unwrap_or(1024 * 1024));
    let wanted = digests.unwrap_or(false);
    let at = Path::new(&root);
    let arenas = AllocatorPool::new(rayon::current_num_threads());
    let opening = ThreadPoolBuilder::new()
        .num_threads(
            readers
                .map_or(READERS, |count| count as usize)
                .min(files.len().max(1)),
        )
        .build();
    let mut read = Vec::with_capacity(files.len());
    let mut chunks = files.chunks(CHUNK);
    let Some(first) = chunks.next() else {
        return read;
    };

    let mut held = open_all(at, first, largest, wanted, &opening);
    for next in chunks {
        let (parsed, fresh) = rayon::join(
            || parse_all(held, &arenas, symbols),
            || open_all(at, next, largest, wanted, &opening),
        );
        read.extend(parsed);
        held = fresh;
    }
    read.extend(parse_all(held, &arenas, symbols));
    read
}

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
    let work = || {
        files
            .par_iter()
            .map(|file| open(root, file, largest, digests))
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
    opened: Vec<(&str, Opened, String)>,
    arenas: &AllocatorPool,
    symbols: bool,
) -> Vec<Answer> {
    opened
        .into_par_iter()
        .map(|(file, held, digest)| match held {
            Opened::Settled(read) => (read, digest, false),
            Opened::Source(source) => (
                read_module(file, &source, &arenas.get(), symbols),
                digest,
                true,
            ),
        })
        .collect()
}

fn open<'a>(root: &Path, file: &'a str, largest: u64, digests: bool) -> (&'a str, Opened, String) {
    let settled = |unknown| {
        (
            file,
            Opened::Settled(Read {
                unknown: Some(unknown),
                ..Read::default()
            }),
            String::new(),
        )
    };
    let mut held = match fs::File::open(root.join(file)) {
        Ok(held) => held,
        Err(error) => return settled(format!("{file} could not be read: {error}")),
    };
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
    let digest = if digests {
        digest::of_string(&source)
    } else {
        String::new()
    };
    (file, Opened::Source(source), digest)
}

fn ordered(count: usize, answers: impl IntoIterator<Item = Numbered>) -> Vec<Answer> {
    let mut held: Vec<Option<Answer>> = (0..count).map(|_| None).collect();
    for (index, answer) in answers {
        held[index] = Some(answer);
    }
    held.into_iter().flatten().collect()
}

fn too_large(file: &str, size: u64, largest: u64) -> String {
    format!(
        "{file} is {size} bytes, over the {largest} this scan opens: parsing it \
         costs about fifty times that in memory, and it is almost certainly built \
         output. Raise `largestFile` to read it anyway."
    )
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use oxc_allocator::AllocatorPool;

    use super::read_blob;

    #[test]
    fn an_oversized_blob_is_drained_without_losing_the_next_answer() {
        let mut stream = Cursor::new(b"one blob 4\nxxxx\ntwo blob 19\nexport const y = 1\n\n");
        let arenas = AllocatorPool::new(1);

        let (oversized, _, parsed) = read_blob(
            std::path::Path::new("."),
            "large.ts",
            &mut stream,
            1,
            false,
            &arenas,
            true,
        );
        let (_, _, next_parsed) = read_blob(
            std::path::Path::new("."),
            "next.ts",
            &mut stream,
            1024,
            false,
            &arenas,
            true,
        );

        assert!(!parsed);
        assert!(oversized.unknown.is_some());
        assert!(next_parsed);
    }
}
