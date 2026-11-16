//! Open bounded source bytes from the worktree or the indexed Git identity.
// compass: variance-authority.reach.source-index

use std::fs;
use std::io::{ErrorKind, Read as _};
use std::path::Path;
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuildError};
use crate::{digest, commit_text::PackedBlob, git::Oid, git_store::Objects, source_read::SourceRead};
use super::{too_large, Outcome};

pub(super) enum Opened {
    Source(String),
    Settled(SourceRead, Outcome),
    DeclinedBlob(SourceRead, Oid),
}

pub(super) fn open_all<'a>(
    root: &Path,
    files: &'a [String],
    oids: &[Option<Oid>],
    largest: u64,
    digests: bool,
    opening: &Result<ThreadPool, ThreadPoolBuildError>,
    packed: Option<&Objects>,
) -> Vec<(&'a str, Opened, String, bool)> {
    if let Some(objects) = packed { return open_blobs(root, files, oids, largest, digests, objects, opening); }
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

/// The file's text, its digest when `digests`, and whether it is the blob `oid` names.
pub(super) fn open<'a>(
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
                SourceRead::unreadable(unknown),
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


fn open_blobs<'a>(root: &Path, files: &'a [String], oids: &[Option<Oid>], largest: u64,
    digests: bool, objects: &Objects, opening: &Result<ThreadPool, ThreadPoolBuildError>) -> Vec<(&'a str, Opened, String, bool)> {
    let ids: Vec<Oid> = oids.iter().flatten().copied().collect();
    // Detect the bounded LFS representation before limiting its source content.
    let limit = largest.max(crate::lfs::POINTER_LIMIT);
    let rows = match opening {
        Ok(pool) => pool.install(|| objects.blobs_with_readers(&ids, limit, pool.current_num_threads())),
        Err(_) => objects.blobs(&ids, limit),
    };
    let mut read = rows.into_iter();
    let (mut unindexed, mut lfs, mut failed) = (0, 0, 0);
    let rows = files.iter().enumerate().map(|(at, file)| {
        let Some(id) = oids.get(at).and_then(Option::as_ref) else {
            unindexed += 1;
            return open(root, file, largest, digests, None);
        };
        let read = read.next().unwrap_or_else(|| Err("Git returned no answer for the indexed blob".to_owned()));
        if read.is_err() { failed += 1; }
        if matches!(&read, Ok(PackedBlob::Bytes(bytes)) if crate::lfs::pointer(bytes)) { lfs += 1; }
        blob(root, file, id, read, largest, digests)
    }).collect();
    if crate::timings::enabled() {
        eprintln!("sense Git packed acquisition: {} indexed rows; {unindexed} unindexed worktree reads; {lfs} LFS worktree reads; {failed} failed Git reads", ids.len());
    }
    rows
}

pub(super) fn blob<'a>(root: &Path, file: &'a str, id: &Oid, read: Result<PackedBlob, String>,
    largest: u64, digests: bool) -> (&'a str, Opened, String, bool) {
    let settled = |why, outcome| (file, Opened::Settled(SourceRead::unreadable(why), outcome), String::new(), false);
    let declined = |why| (file, Opened::DeclinedBlob(SourceRead::unreadable(why), *id), String::new(), false);
    let bytes = match read {
        Err(why) => return settled(format!("{file} could not be read from Git: {why}"), Outcome::Failed),
        Ok(PackedBlob::Large(size)) => return declined(too_large(file, size, largest)),
        Ok(PackedBlob::Bytes(bytes)) => bytes,
    };
    if crate::lfs::pointer(&bytes) { return open(root, file, largest, digests, Some(id)); }
    if bytes.len() as u64 > largest { return declined(too_large(file, bytes.len() as u64, largest)); }
    let source = match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(_) => return declined(format!("{file} is not UTF-8, so this scan does not parse it: stream did not contain valid UTF-8")),
    };
    let digest = if digests { digest::of_string(&source) } else { String::new() };
    (file, Opened::Source(source), digest, true)
}
