//! The walk of the module closure: read a wave, resolve its requests, enter
//! what they reach, until a wave reaches nothing new.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::cell::{Cell, RefCell};
use std::path::Path;
use std::sync::Arc;

use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

use super::GraphOptions;
use crate::acquire::{read_git_kept, Answer, Outcome, TreeObjects, LARGEST_FILE};
use crate::emitted::{Emitted, Listing};
use crate::git::{self, Oid};
use crate::parse_origin::FromBlob;
use crate::resolve::Resolvers;
use crate::source_languages::LanguageWorld;
use crate::source_read::SourceRead;

const RESOLVERS: usize = 6;
/// Files a wave reads before it resolves them while reading the next.
const SLICE: usize = 16_384;

/// What a walk of the module closure read: one row per file, in the order the
/// waves reached them, with the digest each row is named by and the target of
/// each request.
pub(crate) struct Walked {
    pub files: Vec<String>,
    /// The admitted Git identity or the digest of the bytes acquired.
    pub identities: Vec<String>,
    pub read: Vec<Answer>,
    pub targets: Vec<Vec<Vec<String>>>,
    /// Whether each row was answered by a parse the caller kept, rather than read.
    pub kept: Vec<bool>,
    /// Fresh parses acquired here, including Rust facts outside this closure.
    pub parsed: u32,
}

/// A parse the caller keeps by content identity and the file's reading mode.
pub(crate) type Kept<'k> = &'k dyn Fn(&str, &str) -> Option<SourceRead>;

/// The identity acquisition proved, and whether its parse was already held.
pub(crate) struct Acquired {
    pub identity: String,
    pub kept: bool,
}

pub(crate) struct Consumed<C> {
    pub rows: Vec<C>,
    pub parsed: u32,
}

/// The walk itself, shared by the batch that crosses as columns, the graph
/// that stays on this side (`graph_index.rs`) and a warm update, so none can
/// reach a different closure. It does not enter a target `held` names: the
/// seeds are read whatever they are, and the files the caller already holds a
/// record for are the boundary of what a warm update has to open
/// (`source_update.rs`). Eligible Git identities can reuse a parse before
/// opening; worktree reads prove their identity from the bytes first.
pub(crate) fn walk_beyond(
    options: GraphOptions,
    paths: &[String],
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    held: &dyn Fn(&str) -> bool,
    kept: Kept,
    supplied: Option<&HashMap<String, String>>,
    from_blob: &FromBlob,
    store: &TreeObjects,
    session: &crate::scan_session::State,
) -> Walked {
    let consumed = walk_consumed(options, paths, at, tree_oids, listing, held, kept, supplied, from_blob, store, session,
        |files, read, acquired, targets| {
            let (identities, kept) = acquired.into_iter().map(|row| (row.identity, row.kept)).unzip();
            Walked { files: files.to_vec(), identities, read, targets: targets.to_vec(), kept, parsed: 0 }
        });
    let mut walked = Walked { files: Vec::new(), identities: Vec::new(), read: Vec::new(), targets: Vec::new(), kept: Vec::new(), parsed: consumed.parsed };
    for mut slice in consumed.rows {
        walked.files.append(&mut slice.files);
        walked.identities.append(&mut slice.identities);
        walked.read.append(&mut slice.read);
        walked.targets.append(&mut slice.targets);
        walked.kept.append(&mut slice.kept);
    }
    walked
}

/// The same closure walk, consuming each resolved slice before its rich facts
/// leave the resolver thread. Acquisition of the next slice overlaps that work.
pub(crate) fn walk_consumed<C: Send>(
    options: GraphOptions,
    paths: &[String],
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    held: &dyn Fn(&str) -> bool,
    kept: Kept,
    supplied: Option<&HashMap<String, String>>,
    from_blob: &FromBlob,
    store: &TreeObjects,
    session: &crate::scan_session::State,
    mut consume: impl FnMut(&[String], Vec<Answer>, Vec<Acquired>, &[Vec<Vec<String>>]) -> C + Send,
) -> Consumed<C> {
    let started = std::time::Instant::now();
    let timings = std::env::var("VARIANCE_SENSE_TIMINGS").is_ok_and(|value| value == "1");
    let reading_time = Cell::new(std::time::Duration::ZERO);
    let resolving_time = std::sync::atomic::AtomicU64::new(0);
    let parsed = Cell::new(0u32);
    let mut prefetched_count = 0;
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
    let filesystem = Emitted::listed_for(root_path, Some(Arc::clone(&listing)), store.allows_blobs());
    let resolvers = Resolvers::over(tsconfig, condition_names, filesystem.clone());
    let languages = LanguageWorld::new(paths, root_path);
    #[cfg(feature = "grammars")]
    let prefetched = &session.prefetched;
    #[cfg(not(feature = "grammars"))]
    let prefetched = RefCell::new(HashMap::<String, (Answer, Acquired)>::new());
    #[cfg(feature = "grammars")]
    let mut rust_prepared = false;
    let mut consumed = Vec::new();
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
        // Rust resolves against every declared module, including files outside
        // the seeds. Acquire those facts once and consume these same answers
        // when the normal walk reaches them.
        #[cfg(feature = "grammars")]
        if !rust_prepared && wave.iter().any(|file| crate::source_read::language(file) == Some("rust")) {
            let world = session.rust.get_or_init(|| {
                let began = std::time::Instant::now();
                let mut rust: Vec<String> = paths.iter().filter(|file| crate::source_read::language(file) == Some("rust")).cloned().collect();
                rust.sort_by(|left, right| crate::order::code_unit(left, right));
                let oids = rust.iter().map(|file| at.get(file).and_then(|index| tree_oids.get(*index as usize)).copied()).collect();
                let (reads, kept) = read_kept(&root, store, &rust, oids, largest_file, Some(true), readers, kept, supplied, from_blob, Some(&listing));
                parsed.set(parsed.get() + reads.iter().zip(&kept).filter(|((_, _, outcome), acquired)| outcome.parsed() && !acquired.kept).count() as u32);
                prefetched_count = rust.len();
                prefetched.borrow_mut().extend(rust.into_iter().zip(reads.into_iter().zip(kept)));
                reading_time.set(reading_time.get() + began.elapsed());
                let borrowed = prefetched.borrow();
                let facts = borrowed.iter().filter_map(|(file, ((read, _, _), _))| read.language().map(|read| (file.as_str(), read)));
                Arc::new(crate::rust_resolve::RustWorld::from_rows(paths, facts, root_path))
            });
            languages.prepared_rust(Arc::clone(world));
            rust_prepared = true;
        }
        let oids: Vec<Option<Oid>> = wave
            .iter()
            .map(|file| at.get(file).and_then(|index| tree_oids.get(*index as usize)).copied())
            .collect();
        // Eligible OIDs select Git blobs; changed, untracked and symbolic paths
        // select the worktree. Declarations
        // come out of the same parse: `ask symbol` reads them from the rows this
        // walk publishes, and a walk that left them out answered a checkout of
        // ten thousand modules as if it declared nothing.
        let reading = |slice: &[String], oids| {
            let began = std::time::Instant::now();
            let hits: Vec<_> = slice.iter().map(|file| prefetched.borrow_mut().remove(file)).collect();
            let (unread, unread_oids): (Vec<_>, Vec<_>) = slice.iter().zip(oids).zip(&hits)
                .filter(|(_, hit)| hit.is_none()).map(|((file, oid), _)| (file.clone(), oid)).unzip();
            let (fresh, answered) = read_kept(&root, store, &unread, unread_oids, largest_file, Some(true), Some(readers.unwrap_or(6).max(1)), kept, supplied, from_blob, Some(&listing));
            parsed.set(parsed.get() + fresh.iter().zip(&answered).filter(|((_, _, outcome), acquired)| outcome.parsed() && !acquired.kept).count() as u32);
            let mut fresh = fresh.into_iter().zip(answered);
            let rows = hits.into_iter().map(|hit| hit.unwrap_or_else(|| fresh.next().expect("every unread file has one answer"))).unzip();
            reading_time.set(reading_time.get() + began.elapsed());
            rows
        };
        let resolving = |slice: &[String], read: &[Answer]| {
            let began = std::time::Instant::now();
            let rows = resolve_all(root_path, slice, read, &resolvers, Some(at), &languages);
            resolving_time.fetch_add(began.elapsed().as_micros() as u64, std::sync::atomic::Ordering::Relaxed);
            rows
        };
        let (slices, resolved) = read_resolved(&wave, SLICE, oids, reading, resolving, &mut consume);
        for target in resolved.iter().flatten().flatten() {
            if crate::seed::readable(target) && !held(target) && seen.insert(target.clone()) {
                queue.push(target.clone());
            }
        }
        consumed.extend(slices);
    }
    if timings {
        eprintln!("sense walk: {:.1} ms; acquire/parse {:.1} ms; resolve {:.1} ms; Rust prefetched {prefetched_count}", started.elapsed().as_secs_f64() * 1000.0, reading_time.get().as_secs_f64() * 1000.0, resolving_time.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1000.0);
        if let Some(counts) = filesystem.metadata_counts() { eprintln!("sense walk: {counts}"); }
    }
    Consumed { rows: consumed, parsed: parsed.get() }
}

/// Reads `wave` `slice` files at a time and resolves each slice while the next is read.
/// Reads parse on the cores and resolves wait on the file system's path lookups, so
/// neither waits for the other's whole wave; the rows keep the wave's order.
fn read_resolved<'w, R, A, T, C>(
    wave: &'w [String],
    slice: usize,
    oids: Vec<Option<Oid>>,
    reading: impl Fn(&'w [String], Vec<Option<Oid>>) -> (Vec<R>, Vec<A>),
    resolving: impl Fn(&'w [String], &[R]) -> Vec<T> + Sync,
    consume: &mut (impl FnMut(&'w [String], Vec<R>, Vec<A>, &[T]) -> C + Send),
) -> (Vec<C>, Vec<T>)
where
    R: Send + Sync,
    A: Send,
    T: Send,
    C: Send,
{
    let (mut consumed, mut targets) = (Vec::new(), Vec::with_capacity(wave.len()));
    let (mut slices, mut oids) = (wave.chunks(slice.max(1)), oids.into_iter());
    let mut previous: Option<(&'w [String], Vec<R>, Vec<A>)> = None;
    loop {
        let next = slices.next();
        if next.is_none() && previous.is_none() {
            return (consumed, targets);
        }
        let (fresh, resolved) = std::thread::scope(|scope| {
            let consume = &mut *consume;
            let resolving = &resolving;
            let resolving = previous.take().map(|(files, rows, acquired)| scope.spawn(move || {
                let targets = resolving(files, &rows);
                (consume(files, rows, acquired, &targets), targets)
            }));
            let fresh = next.map(|files| (files, reading(files, oids.by_ref().take(files.len()).collect())));
            (fresh, resolving.map(|thread| thread.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))))
        });
        if let Some((slice, resolved)) = resolved {
            consumed.push(slice);
            targets.extend(resolved);
        }
        if let Some((files, (rows, kept))) = fresh {
            previous = Some((files, rows, kept));
        }
    }
}

/// Read `files`, consulting `kept` before acquisition only for eligible Git
/// blobs or identities the caller supplied; each answer carries the identity
/// proved and whether its parse was held.
/// `from_blob` is told of every tracked file read, and whether its bytes were the blob named.
#[allow(clippy::too_many_arguments)]
pub(super) fn read_kept(
    root: &str,
    store: &TreeObjects,
    files: &[String],
    oids: Vec<Option<Oid>>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    kept: Kept,
    supplied: Option<&HashMap<String, String>>,
    from_blob: &FromBlob,
    listing: Option<&Listing>,
) -> (Vec<Answer>, Vec<Acquired>) {
    let objects = oids.iter().zip(files).any(|(oid, file)| oid.is_some()
        && listing.is_some_and(|listing| listing.is_file(Path::new(file))))
        .then(|| store.objects_now(Path::new(root))).flatten();
    let hits: Vec<Option<(SourceRead, String)>> = files
        .iter()
        .zip(&oids)
        .map(|(file, oid)| {
            let eligible = objects.is_some() && oid.is_some()
                && listing.is_some_and(|listing| listing.is_file(Path::new(file)));
            let identity = if let Some(identity) = supplied.and_then(|known| known.get(file)) {
                identity.clone()
            } else {
                if !eligible { return None }
                git::spell(oid.as_ref()?)
            };
            let read = kept(&identity, file)?;
            // Cached facts prove no size their reader did not measure. Reacquire
            // unknown or oversized rows under this scan's limit; an admitted
            // blob's header owns that decision, never its worktree metadata.
            let limit = u64::from(largest_file.unwrap_or(LARGEST_FILE));
            if read.size().is_none_or(|size| u64::from(size.bytes) > limit) {
                return None;
            }
            Some((read, identity))
        })
        .collect();
    let (unread, unread_oids): (Vec<String>, Vec<Option<Oid>>) = files
        .iter()
        .zip(oids)
        .zip(&hits)
        .filter(|(_, hit)| hit.is_none())
        .map(|((file, oid), _)| (file.clone(), oid))
        .unzip();
    let (fresh, named, reused) = if unread.is_empty() {
        (Vec::new(), Vec::new(), Vec::new())
    } else {
        let vouched: Option<Vec<bool>> = listing.map(|listing| unread.iter().map(|file| listing.is_file(Path::new(file))).collect());
        read_git_kept(objects.as_deref(), root.to_owned(), unread.clone(), unread_oids.clone(), largest_file, digests, readers, true, kept, vouched.as_deref())
    };
    for ((file, oid), origin) in unread.iter().zip(&unread_oids).zip(&named) {
        if let Some(oid) = oid {
            from_blob.saw(oid, file, origin.parsed_blob());
        }
    }
    let mut fresh = fresh.into_iter().zip(reused).zip(named).zip(unread_oids);
    let mut read = Vec::with_capacity(files.len());
    let mut answered = Vec::with_capacity(files.len());
    for hit in hits {
        match hit {
            Some((held, identity)) => {
                read.push((held, identity.clone(), Outcome::Parsed));
                answered.push(Acquired { identity, kept: true });
            }
            None => {
                let (((held, kept), origin), oid) = fresh.next().expect("every unread file has one answer");
                let identity = origin.identity(oid.as_ref(), &held.1);
                read.push(held); answered.push(Acquired { identity, kept });
            }
        }
    }
    (read, answered)
}

pub(super) fn resolve_all(
    _root: &Path,
    files: &[String],
    read: &[Answer],
    resolvers: &Resolvers,
    known: Option<&HashMap<String, u32>>,
    languages: &LanguageWorld,
) -> Vec<Vec<Vec<String>>> {
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
                held.requests()
                    .enumerate()
                    .map(|(index, _)| languages.resolve(file, held, index, resolvers, known))
                    .collect()
            })
            .collect()
    };
    match resolving {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }
}

#[cfg(test)]
#[path = "batch_walk_tests.rs"]
mod tests;
