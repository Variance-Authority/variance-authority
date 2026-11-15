//! The walk of the module closure: read a wave, resolve its requests, enter
//! what they reach, until a wave reaches nothing new.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

use super::GraphOptions;
use crate::acquire::{read_git, Answer, Outcome, WaveStore, LARGEST_FILE};
use crate::emitted::{Emitted, Listing};
use crate::git::{self, Oid};
use crate::parse_origin::FromBlob;
use crate::resolve::Resolvers;

const RESOLVERS: usize = 6;
/// Files a wave reads before it resolves them while reading the next.
const SLICE: usize = 16_384;

/// What a walk of the module closure read: one row per file, in the order the
/// waves reached them, with the digest each row is named by and the target of
/// each request.
pub(crate) struct Walked {
    pub files: Vec<String>,
    /// Git's object name for a file the tree holds, the read digest otherwise.
    pub identities: Vec<String>,
    pub read: Vec<Answer>,
    pub targets: Vec<Vec<String>>,
    /// Whether each row was answered by a parse the caller kept, rather than read.
    pub kept: Vec<bool>,
}

/// A parse the caller keeps for a file, by Git's name for its content and its path.
pub(crate) type Kept<'k> = &'k dyn Fn(&str, &str) -> Option<crate::read::Read>;

/// The walk itself, shared by the batch that crosses as columns, the graph
/// that stays on this side (`graph_index.rs`) and a warm update, so none can
/// reach a different closure. It does not enter a target `held` names: the
/// seeds are read whatever they are, and the files the caller already holds a
/// record for are the boundary of what a warm update has to open
/// (`source_update.rs`). A file whose content `kept` answers is not opened:
/// its parse is the kept one.
pub(crate) fn walk_beyond(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    held: &dyn Fn(&str) -> bool,
    kept: Kept,
    from_blob: &FromBlob,
    store: &WaveStore,
) -> Walked {
    let GraphOptions {
        root,
        seeds,
        largest_file,
        readers,
        tsconfig,
        condition_names,
        include_parses: _,
    } = options;
    let root_path = Path::new(&root);
    let resolvers = Resolvers::over(tsconfig, condition_names, Emitted::listed(root_path, Some(listing)));
    let mut files = Vec::new();
    let mut read = Vec::new();
    let mut targets = Vec::new();
    let mut identities = Vec::new();
    let mut answered = Vec::new();
    let mut queue = Vec::new();
    let mut seen = HashSet::with_capacity(seeds.len() * 2);
    for file in seeds {
        if seen.insert(file.clone()) {
            queue.push(file);
        }
    }
    let mut head = 0;

    while head < queue.len() {
        let wave = queue[head..].to_vec();
        head = queue.len();
        let oids: Vec<Option<Oid>> = wave
            .iter()
            .map(|file| at.get(file).map(|index| tree_oids[*index as usize]))
            .collect();
        let wave_identities = oids
            .iter()
            .map(|oid| oid.as_ref().map(git::spell))
            .collect::<Vec<_>>();
        // The wave's OIDs already name every tracked file's content, so once the
        // walk has read enough to open the store the blobs come out of the pack
        // rather than off the disk. `read_git` falls back to opening the file
        // whenever a blob is missing or unreadable, which is what answers for
        // the dirty and untracked members of the wave. Declarations
        // come out of the same parse: `ask symbol` reads them from the rows this
        // walk publishes, and a walk that left them out answered a checkout of
        // ten thousand modules as if it declared nothing.
        // FIXME: every wave's answers, declarations included, are held until the
        // parse segment is encoded after the walk, so a cold index of 288k paths
        // peaks near 3.3 GB against a 600 MB read ceiling; encoding each wave as
        // it is read would bound it.
        let reading = |slice: &[String], oids| {
            read_kept(&root, store, slice, oids, largest_file, Some(true), Some(readers.unwrap_or(6).max(1)), kept, from_blob)
        };
        let resolving = |slice: &[String], read: &[Answer]| resolve_all(root_path, slice, read, &resolvers, Some(at));
        let (opened, wave_kept, resolved) = read_resolved(&wave, SLICE, oids, reading, resolving);
        answered.extend(wave_kept);
        for target in resolved.iter().flatten() {
            if is_module(target) && !held(target) && seen.insert(target.clone()) {
                queue.push(target.clone());
            }
        }
        files.extend(wave);
        identities.extend(
            wave_identities
                .into_iter()
                .zip(&opened)
                .map(|(identity, (_, digest, _))| identity.unwrap_or_else(|| digest.clone())),
        );
        read.extend(opened);
        targets.extend(resolved);
    }
    Walked { files, identities, read, targets, kept: answered }
}

/// Reads `wave` `slice` files at a time and resolves each slice while the next is read.
/// Reads parse on the cores and resolves wait on the file system's path lookups, so
/// neither waits for the other's whole wave; the rows keep the wave's order.
fn read_resolved<'w, R>(
    wave: &'w [String],
    slice: usize,
    oids: Vec<Option<Oid>>,
    mut reading: impl FnMut(&'w [String], Vec<Option<Oid>>) -> (Vec<R>, Vec<bool>),
    resolving: impl Fn(&'w [String], &[R]) -> Vec<Vec<String>> + Sync,
) -> (Vec<R>, Vec<bool>, Vec<Vec<String>>)
where
    R: Send + Sync,
{
    let (mut read, mut answered, mut targets) =
        (Vec::with_capacity(wave.len()), Vec::with_capacity(wave.len()), Vec::with_capacity(wave.len()));
    let (mut slices, mut oids) = (wave.chunks(slice.max(1)), oids.into_iter());
    let mut previous: Option<(&'w [String], Vec<R>)> = None;
    loop {
        let next = slices.next();
        if next.is_none() && previous.is_none() {
            return (read, answered, targets);
        }
        let (fresh, resolved) = std::thread::scope(|scope| {
            let resolving = previous.as_ref().map(|(files, rows)| scope.spawn(|| resolving(files, rows)));
            let fresh = next.map(|files| (files, reading(files, oids.by_ref().take(files.len()).collect())));
            (fresh, resolving.map(|thread| thread.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))))
        });
        read.extend(previous.take().map(|(_, rows)| rows).into_iter().flatten());
        targets.extend(resolved.into_iter().flatten());
        if let Some((files, (rows, kept))) = fresh {
            answered.extend(kept);
            previous = Some((files, rows));
        }
    }
}

/// Read `files` from Git, answering from `kept` every tracked one whose
/// content it holds rather than opening it; with each answer, whether `kept` gave it.
/// `from_blob` is told of every tracked file read, and whether its bytes were the blob named.
#[allow(clippy::too_many_arguments)]
pub(super) fn read_kept(
    root: &str,
    store: &WaveStore,
    files: &[String],
    oids: Vec<Option<Oid>>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    kept: Kept,
    from_blob: &FromBlob,
) -> (Vec<Answer>, Vec<bool>) {
    let hits: Vec<Option<(crate::read::Read, String)>> = files
        .iter()
        .zip(&oids)
        .map(|(file, oid)| {
            let identity = git::spell(oid.as_ref()?);
            let read = kept(&identity, file)?;
            // A parse is kept whatever limit read it, so one over this scan's is read again, to be
            // declined; a reader that measured nothing leaves the size to the file on disk, and a
            // size neither tells is read again from Git, which declines by the blob's. No limit is
            // the default a fresh read applies (`acquire.rs`), not none.
            let limit = u64::from(largest_file.unwrap_or(LARGEST_FILE));
            let bytes = read.size.as_ref().map(|size| u64::from(size.bytes));
            let over = bytes.or_else(|| std::fs::metadata(Path::new(root).join(file)).ok().map(|entry| entry.len())).is_none_or(|bytes| bytes > limit);
            (!over).then_some((read, identity))
        })
        .collect();
    let (unread, unread_oids): (Vec<String>, Vec<Option<Oid>>) = files
        .iter()
        .zip(oids)
        .zip(&hits)
        .filter(|(_, hit)| hit.is_none())
        .map(|((file, oid), _)| (file.clone(), oid))
        .unzip();
    let (fresh, named) = if unread.is_empty() {
        (Vec::new(), Vec::new())
    } else {
        read_git(store.objects(Path::new(root), unread.len()).as_deref(), root.to_owned(), unread.clone(), unread_oids.clone(), largest_file, digests, readers, true)
    };
    for ((file, oid), named) in unread.iter().zip(&unread_oids).zip(named) {
        if let Some(oid) = oid {
            from_blob.saw(oid, file, named);
        }
    }
    let mut fresh = fresh.into_iter();
    let mut read = Vec::with_capacity(files.len());
    let mut answered = Vec::with_capacity(files.len());
    for hit in hits {
        answered.push(hit.is_some());
        match hit {
            Some((held, identity)) => read.push((held, identity, Outcome::Parsed)),
            None => read.extend(fresh.next()),
        }
    }
    (read, answered)
}

pub(super) fn resolve_all(
    root: &Path,
    files: &[String],
    read: &[Answer],
    resolvers: &Resolvers,
    known: Option<&HashMap<String, u32>>,
) -> Vec<Vec<String>> {
    let resolving = ThreadPoolBuilder::new()
        .num_threads(RESOLVERS.min(files.len().max(1)))
        .build();
    let work = || {
        files
            .par_iter()
            .zip(read.par_iter())
            .map(|(file, (held, _, outcome))| {
                if !outcome.parsed() {
                    return Vec::new();
                }
                let from = root.join(file);
                held.requests
                    .iter()
                    .map(|request| {
                        resolvers
                            .resolve(root, &from, &request.value, known)
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .collect()
    };
    match resolving {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }
}

pub(crate) fn is_module(file: &str) -> bool {
    matches!(
        Path::new(file).extension().and_then(|part| part.to_str()),
        Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    type Row = (String, Option<u8>);

    /// Each file's row, kept flag and targets come from that file, in the wave's
    /// order, whether the wave is one slice, a few, or slices that do not divide it.
    #[test]
    fn a_sliced_wave_keeps_every_file_on_its_own_row() {
        let wave: Vec<String> = (0..7).map(|n| format!("f{n}.ts")).collect();
        let oids: Vec<Option<Oid>> = (0..7u8).map(|n| (n % 2 == 0).then_some([n; 20])).collect();
        let expected: Vec<Row> = wave.iter().zip(0u8..).map(|(file, n)| (file.clone(), (n % 2 == 0).then_some(n))).collect();
        for slice in [1, 3, 7, 16] {
            let reading = |files: &[String], oids: Vec<Option<Oid>>| {
                assert_eq!(files.len(), oids.len());
                let rows: Vec<Row> = files.iter().zip(&oids).map(|(file, oid)| (file.clone(), oid.map(|oid| oid[0]))).collect();
                (rows, oids.iter().map(Option::is_some).collect())
            };
            let resolving = |files: &[String], rows: &[Row]| {
                files.iter().zip(rows).map(|(file, (row, _))| vec![format!("{file} read {row}")]).collect()
            };
            let (read, kept, targets) = read_resolved(&wave, slice, oids.clone(), reading, resolving);
            assert_eq!(read, expected, "slice {slice}");
            assert_eq!(kept, oids.iter().map(Option::is_some).collect::<Vec<_>>(), "slice {slice}");
            assert_eq!(targets, wave.iter().map(|file| vec![format!("{file} read {file}")]).collect::<Vec<_>>(), "slice {slice}");
        }
    }

    #[test]
    fn an_empty_wave_reads_and_resolves_nothing() {
        let (read, kept, targets) = read_resolved(
            &[],
            SLICE,
            Vec::new(),
            |_: &[String], _| -> (Vec<Row>, Vec<bool>) { panic!("nothing to read") },
            |_: &[String], _: &[Row]| -> Vec<Vec<String>> { panic!("nothing to resolve") },
        );
        assert!(read.is_empty() && kept.is_empty() && targets.is_empty());
    }
}
