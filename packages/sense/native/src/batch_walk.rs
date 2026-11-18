//! The walk of the closure: read a wave, resolve its requests, enter every
//! readable file they reach, until a wave reaches nothing new.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

use super::GraphOptions;
use crate::acquire::{read_all, read_git, Answer, Outcome, TreeObjects, LARGEST_FILE};
use crate::emitted::{Emitted, Listing};
use crate::git::{self, Oid};
use crate::parse_origin::FromBlob;
use crate::read_any::{language_of, Language};
use crate::resolve::Resolvers;
use crate::world::World;

use super::neighbours::Neighbours;

/// Threads resolving a slice: every core. Resolving waits on the filesystem
/// as much as it computes, and on Kibana six threads left 0.5 s of a cold
/// index on the table that ten, twelve and sixteen all took back.
fn resolving_width() -> usize {
    std::thread::available_parallelism().map_or(6, usize::from)
}
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
    pub targets: Vec<Reached>,
    /// Whether each row was answered by a parse the caller kept, rather than read.
    pub kept: Vec<bool>,
}

/// Where one file's requests land: the target of each, in request order and
/// empty where it lands nowhere, and every further file a request reaches,
/// by the request's index. A Swift import is a whole target's directory, and
/// a Java wildcard its package's: the first is the request's target and the
/// rest are edges too.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Reached {
    pub first: Vec<String>,
    pub more: Vec<(u32, String)>,
}

impl Reached {
    /// Every file reached, the targets first.
    pub(crate) fn all(&self) -> impl Iterator<Item = &String> {
        self.first.iter().chain(self.more.iter().map(|(_, file)| file))
    }
}

/// A parse the caller keeps for a file, by Git's name for its content and its path.
pub(crate) type Kept<'k> = &'k (dyn Fn(&str, &str) -> Option<crate::read::Read> + Sync);

/// The walk itself, shared by the batch that crosses as columns, the graph
/// that stays on this side (`graph_index.rs`) and a warm update, so none can
/// reach a different closure. It does not enter a target `held` names: the
/// seeds are read whatever they are, and the files the caller already holds a
/// record for are the boundary of what a warm update has to open
/// (`source_update.rs`). A file whose content `kept` answers is not opened:
/// its parse is the kept one. `world` is the caller's, built once per run
/// over the same tree ([`neighbours`](super::neighbours)), so a warm update
/// that walks round after round builds Rust's module tree, and parses every
/// `.rs` file for it, once rather than every round. The tree is built before
/// the wave that needs it is read, and the wave takes the files it read from
/// `read`, so a cold walk parses each `.rs` file once.
#[allow(clippy::too_many_arguments)]
pub(crate) fn walk_beyond(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    world: &World,
    read_by_world: &Neighbours,
    held: &dyn Fn(&str) -> bool,
    kept: Kept,
    from_blob: &FromBlob,
    store: &TreeObjects,
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
        world.prewarm(wave.iter().filter_map(|file| language_of(file)));
        let reading = |slice: &[String], oids| {
            read_by_world.first(slice, oids, |unread, oids| {
                read_kept(&root, store, unread, oids, largest_file, Some(true), Some(readers.unwrap_or(6).max(1)), kept, from_blob)
            })
        };
        let resolving = |slice: &[String], read: &[Answer]| resolve_all(root_path, slice, read, &resolvers, world, Some(at));
        let (opened, wave_kept, resolved) = read_resolved(&wave, SLICE, oids, reading, resolving);
        answered.extend(wave_kept);
        for target in resolved.iter().flat_map(Reached::all) {
            if language_of(target).is_some() && !held(target) && seen.insert(target.clone()) {
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
fn read_resolved<'w, R, T>(
    wave: &'w [String],
    slice: usize,
    oids: Vec<Option<Oid>>,
    reading: impl Fn(&'w [String], Vec<Option<Oid>>) -> (Vec<R>, Vec<bool>),
    resolving: impl Fn(&'w [String], &[R]) -> Vec<T> + Sync,
) -> (Vec<R>, Vec<bool>, Vec<T>)
where
    R: Send + Sync,
    T: Send,
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
    store: &TreeObjects,
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
            Some((held(root, file, &identity, largest_file, kept)?, identity))
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
    around(hits, fresh)
}

/// Read `files` off the disk, answering from `kept` every one `identities`
/// names content it holds for, rather than opening it; with each answer,
/// whether `kept` gave it.
pub(super) fn read_held(
    root: &str,
    files: &[String],
    identities: &[String],
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    kept: Kept,
) -> (Vec<Answer>, Vec<bool>) {
    let hits: Vec<Option<(crate::read::Read, String)>> = files
        .iter()
        .enumerate()
        .map(|(row, file)| {
            let identity = identities.get(row).filter(|identity| !identity.is_empty())?;
            Some((held(root, file, identity, largest_file, kept)?, identity.clone()))
        })
        .collect();
    let unread: Vec<String> = files.iter().zip(&hits).filter(|(_, hit)| hit.is_none()).map(|(file, _)| file.clone()).collect();
    let fresh = if unread.is_empty() { Vec::new() } else { read_all(root.to_owned(), unread, largest_file, digests, readers, true) };
    around(hits, fresh)
}

/// What `kept` holds for `file` under `identity`, when this scan would parse it.
fn held(root: &str, file: &str, identity: &str, largest_file: Option<u32>, kept: Kept) -> Option<crate::read::Read> {
    let read = kept(identity, file)?;
    // A parse is kept whatever limit read it, so one over this scan's is read again, to be
    // declined; a reader that measured nothing leaves the size to the file on disk, and a
    // size neither tells is read again, which declines by the bytes'. No limit is the
    // default a fresh read applies (`acquire.rs`), not none.
    let limit = u64::from(largest_file.unwrap_or(LARGEST_FILE));
    let bytes = read.size.as_ref().map(|size| u64::from(size.bytes));
    let over = bytes.or_else(|| std::fs::metadata(Path::new(root).join(file)).ok().map(|entry| entry.len())).is_none_or(|bytes| bytes > limit);
    (!over).then_some(read)
}

/// Every row in order: a hit as `kept` gave it, a miss as `fresh` read it.
fn around(hits: Vec<Option<(crate::read::Read, String)>>, fresh: Vec<Answer>) -> (Vec<Answer>, Vec<bool>) {
    let mut fresh = fresh.into_iter();
    let mut read = Vec::with_capacity(hits.len());
    let mut answered = Vec::with_capacity(hits.len());
    for hit in hits {
        answered.push(hit.is_some());
        match hit {
            Some((held, identity)) => read.push((held, identity, Outcome::Parsed)),
            None => read.extend(fresh.next()),
        }
    }
    (read, answered)
}

/// Where every request of every parsed file lands. A module's and a
/// stylesheet's go through `resolvers`, landing against `known`; a language
/// that resolves over the tree asks `world`, whose indexes are built here,
/// before the pool, for the languages this slice holds.
pub(super) fn resolve_all(
    root: &Path,
    files: &[String],
    read: &[Answer],
    resolvers: &Resolvers,
    world: &World,
    known: Option<&HashMap<String, u32>>,
) -> Vec<Reached> {
    let mut languages: Vec<Language> = files.iter().filter_map(|file| language_of(file)).collect();
    languages.sort_unstable_by_key(|language| *language as u8);
    languages.dedup();
    // Preparing a language's roots and manifests is resolving, read and parsed or not.
    crate::stages::summed(crate::stages::Sum::Resolve, || world.prewarm(languages));
    let resolving = ThreadPoolBuilder::new()
        .num_threads(resolving_width().min(files.len().max(1)))
        .build();
    let work = || {
        files
            .par_iter()
            .zip(read.par_iter())
            .map(|(file, (held, _, outcome))| crate::stages::summed(crate::stages::Sum::Resolve, || {
                let mut reached = Reached::default();
                if !outcome.parsed() {
                    return reached;
                }
                let from = root.join(file);
                let language = language_of(file).unwrap_or(Language::Module);
                let governing = std::sync::OnceLock::new();
                for (index, request) in held.requests.iter().enumerate() {
                    let landed: Vec<String> = match language {
                        Language::Style => resolvers.resolve_style(root, &from, &request.value, known).into_iter().collect(),
                        Language::Module => resolvers.resolve_from(root, &from, &request.value, known, &governing).into_iter().collect(),
                        _ => world.resolve(language, file, &request.value, request.item),
                    };
                    let mut landed = landed.into_iter();
                    reached.first.push(landed.next().unwrap_or_default());
                    reached.more.extend(landed.map(|file| (index as u32, file)));
                }
                reached
            }))
            .collect()
    };
    match resolving {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }
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

    /// A warm update walks round after round over one tree: the world it is
    /// handed reads every `.rs` file for Rust's module tree once, not per round.
    #[cfg(feature = "grammars")]
    #[test]
    fn rounds_over_one_world_read_the_module_tree_once() {
        use std::sync::Mutex;
        let files = [("src/lib.rs", "mod a;\nmod b;\n"), ("src/a.rs", "use crate::b;\n"), ("src/b.rs", "pub fn b() {}\n")];
        let root = std::env::temp_dir().join(format!("sense-walk-rounds-{}", std::process::id()));
        for (file, text) in files {
            std::fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            std::fs::write(root.join(file), text).unwrap();
        }
        let known: HashMap<String, u32> = files.iter().map(|(file, _)| (*file).to_owned()).zip(0..).collect();
        let asked = Mutex::new(Vec::<String>::new());
        let parsing = |paths: &[&str]| {
            asked.lock().unwrap().extend(paths.iter().map(|path| (*path).to_owned()));
            let held = |path: &str| files.iter().find(|(file, _)| *file == path).map(|(_, text)| *text);
            paths.iter().map(|path| held(path).map(|text| crate::read_any::read_file(path, text, &oxc_allocator::Allocator::default(), true))).collect()
        };
        let texting = |_: &str| None;
        let world = World::new(Some(&known), None).reading(&parsing, &texting);
        let round = |seed: &str| {
            let options = GraphOptions {
                root: root.to_string_lossy().into_owned(),
                seeds: vec![seed.to_owned()],
                largest_file: None,
                readers: None,
                tsconfig: crate::resolve::Tsconfig::from_js(None),
                condition_names: None,
                include_parses: false,
            };
            let listing = Arc::new(Listing::default());
            walk_beyond(options, &HashMap::new(), &[], listing, &world, &Neighbours::default(), &|_| true, &|_, _| None, &FromBlob::default(), &TreeObjects::default())
        };
        let (first, second) = (round("src/lib.rs"), round("src/a.rs"));
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(first.targets[0].first, ["src/a.rs", "src/b.rs"]);
        assert_eq!(second.targets[0].first, ["src/b.rs"]);
        let mut asked = asked.into_inner().unwrap();
        asked.sort_unstable();
        assert_eq!(asked, ["src/a.rs", "src/b.rs", "src/lib.rs"]);
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
