//! The requests each source file writes, kept so a refresh merges what the index gained.
//!
//! The source index is a chain of segments: the base it was readied with and a working layer over it, which
//! each update replaces. A segment says which files were written again and which were deleted. A file's
//! contribution to the lexicon is the external requests it writes, and it is all replaced when the file is
//! written again and all dropped when the file is deleted. So a refresh over the base the record was made
//! over reads only the files the chain writes past that base and the files the record's own working layer
//! wrote, and the rest of the corpus is the record.
//!
//! The record holds the owners as well, because they come from manifests git lists, and asking git for the
//! manifests is the same question a stamp answers for their contents: the list equal and no manifest stamp moved
//! means the owners are the ones recorded. Anything that cannot be merged (a chain that does not start with the
//! record's base, a segment that does not check, a parse the chain does not hold) gives no plan, and the caller
//! reads everything, as it did before there was a record.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::fs;

use serde::{Deserialize, Serialize};

use super::{built, Owner};
use crate::compact::Layer;
use crate::external_dependencies::requests_of;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::NO_OWNER;

const FORMAT: u8 = 2;

/// One request a file writes.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Site {
    pub package: String,
    pub specifier: String,
    pub line: u32,
}

#[derive(Serialize, Deserialize)]
struct Kept {
    manifest: String,
    directory: String,
    name: String,
    kinds: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
pub(super) struct Store {
    format: u8,
    /// The chain this was made from; equal to the one its `Built` names.
    chain: Vec<String>,
    /// How many of `chain`'s first segments are its base.
    base: usize,
    /// Every file the segments of `chain` past its base wrote or deleted.
    working: Vec<String>,
    /// Every `package.json` git lists, whether or not a workspace names it.
    manifests: Vec<String>,
    owners: Vec<Kept>,
    /// The names every named manifest in the checkout gives, workspace or not: what a request is not "external" to.
    internal: Vec<String>,
    /// Files that write at least one external request.
    pub files: BTreeMap<String, Vec<Site>>,
}

/// What a refresh starts from when it can merge.
pub(super) struct Plan {
    pub owners: Vec<Owner>,
    pub internal: Vec<String>,
    pub manifests: Vec<String>,
    pub files: BTreeMap<String, Vec<Site>>,
    /// The paths whose stamp moved since the last refresh.
    pub changed: HashSet<String>,
}

pub(super) fn file(lexicon: &Path) -> std::path::PathBuf {
    lexicon.with_extension("merge.json")
}

fn kind(name: &str) -> &'static str {
    match name { "dependency" => "dependency", "optional" => "optional", "peer" => "peer", _ => "dev" }
}

/// The `package.json` paths git tracks under `root`, in code-unit order. A manifest that is not yet added is
/// not listed: the walk for untracked files costs half a second on a checkout the size of Kibana, and a
/// workspace nobody has added is one the index does not hold either. It is read once `git add` names it.
pub(super) fn manifests(root: &str) -> Option<Vec<String>> {
    let output = std::process::Command::new("git").arg("-C").arg(root)
        .args(["ls-files", "-z", "--cached", "--", "package.json", "*/package.json"])
        .output().ok().filter(|output| output.status.success())?;
    let mut listed: Vec<String> = output.stdout.split(|byte| *byte == 0).filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned()).collect();
    listed.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    listed.dedup();
    Some(listed)
}

/// Every file `layers` write or delete.
fn touched<'a>(layers: &'a [Layer<'a>]) -> Vec<&'a str> {
    let mut paths = Vec::new();
    for layer in layers {
        let (stored, records) = (&layer.stored, &layer.records);
        paths.extend((0..records.deleted.len()).map(|row| stored.text(records.deleted.at(row))));
        paths.extend((0..records.file.len()).map(|row| stored.text(records.file.at(row))));
    }
    paths
}

/// Write the record beside the lexicon, made from `chain`, whose last `working` segments are its working layer.
/// With the working layer unreadable the record is removed instead, and the next refresh reads everything.
#[allow(clippy::too_many_arguments, reason = "the record's every part, each owned by the refresh that writes it")]
pub(super) fn write(lexicon: &Path, index: &str, chain: &[String], working: usize, manifests: Vec<String>, owners: &[Owner], internal: Vec<String>, files: BTreeMap<String, Vec<Site>>) -> std::io::Result<()> {
    let base = chain.len().saturating_sub(working);
    let segments = crate::index_chain::read_tail(index, chain, base);
    let layers = segments.as_ref().and_then(|segments| segments.iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>().ok());
    let Some(layers) = layers else {
        return match fs::remove_file(file(lexicon)) { Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error), _ => Ok(()) };
    };
    let mut working: Vec<String> = touched(&layers).into_iter().map(str::to_owned).collect();
    working.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    working.dedup();
    let owners = owners.iter().map(|owner| Kept {
        manifest: owner.manifest.clone(), directory: owner.directory.clone(), name: owner.name.clone(),
        kinds: owner.kinds.iter().map(|(package, kind)| (package.clone(), (*kind).to_owned())).collect(),
    }).collect();
    let store = Store { format: FORMAT, chain: chain.to_vec(), base, working, manifests, owners, internal, files };
    fs::write(file(lexicon), serde_json::to_vec(&store).map_err(std::io::Error::other)?)
}

/// The record's files, carried from the requests the full orientation reported.
pub(super) fn contributions(sites: impl Iterator<Item = (String, Site)>) -> BTreeMap<String, Vec<Site>> {
    let mut files = BTreeMap::<String, Vec<Site>>::new();
    for (file, site) in sites { files.entry(file).or_default().push(site); }
    for sites in files.values_mut() {
        sites.sort_by(|a, b| a.line.cmp(&b.line).then_with(|| crate::order::code_unit(&a.specifier, &b.specifier)));
    }
    files
}

/// The record merged with what `chain` wrote past the record's base, or `None` when it cannot be trusted to be
/// current.
///
/// An update does not append a segment: it replaces the working layer with one that folds in its own delta.
/// So the chain past the base is not the chain the record holds plus something, and what the record's working
/// layer wrote need not be in the one that replaced it: a worktree seeded from another checkout's index holds
/// that checkout's working layer over the same base. Every file the record's working layer wrote and every file
/// the chain writes past the record's base is read again from the whole chain, and those are the only files
/// whose state can differ from the record's.
pub(super) fn plan(root: &str, index: &str, lexicon: &Path, chain: &[String], held: &built::Built) -> Option<Plan> {
    let store: Store = serde_json::from_slice(&fs::read(file(lexicon)).ok()?).ok()?;
    if store.format != FORMAT || held.chain() != store.chain { return None; }
    let base = &store.chain[..store.base.min(store.chain.len())];
    if base.is_empty() || !chain.starts_with(base) { return None; }
    let listed = manifests(root)?;
    if listed != store.manifests { return None; }
    let changed = held.changed(Path::new(root));
    // A manifest read again is a workspace that may have moved, and the owners are not the record's.
    if changed.iter().any(|path| path == "package.json" || store.manifests.iter().any(|manifest| manifest == path)) { return None; }
    let mut files = store.files;
    let internal = store.internal;
    let owners: Vec<Owner> = store.owners.into_iter().map(|kept| Owner {
        declared: kept.kinds.keys().cloned().collect(),
        kinds: kept.kinds.iter().map(|(package, name)| (package.clone(), kind(name))).collect(),
        manifest: kept.manifest, directory: kept.directory, name: kept.name,
    }).collect();
    if chain != store.chain {
        let internal: HashSet<&str> = internal.iter().map(String::as_str).collect();
        // The working layer alone answers every file it holds. A file it does not, deleted or written back to the
        // bytes the base holds, is answered by the whole chain, and only then is the base opened.
        let read = |from: usize| -> Option<Vec<(String, Option<Vec<Site>>)>> {
            let segments = crate::index_chain::read_tail(index, chain, from)?;
            let layers = segments.iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>().ok()?;
            reread(&layers, base.len() - from, &store.working, &internal, from == 0)
        };
        for (file, sites) in read(base.len()).or_else(|| read(0))? {
            match sites { Some(sites) => { files.insert(file, sites); } None => { files.remove(&file); } }
        }
    }
    Some(Plan { owners, internal, manifests: listed, files, changed })
}

/// Every file the layers past the first `base` write or delete, and every file in `also`, read again as the layers
/// `layers` hold it: no requests when they do not hold it. Unless the layers are the `whole` chain, a file they do not
/// hold may be the base's, so there is no answer.
fn reread(layers: &[Layer], base: usize, also: &[String], internal: &HashSet<&str>, whole: bool) -> Option<Vec<(String, Option<Vec<Site>>)>> {
    let folded = fold(layers);
    let touched = touched(&layers[base..]).into_iter().chain(also.iter().map(String::as_str)).collect::<HashSet<&str>>();
    let mut crossings: Vec<Crossing> = Vec::new();
    let mut read = Vec::new();
    for file in touched {
        match folded.get(file) {
            Some(&at) if is_source(file) => crossings.push(Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }),
            Some(_) => read.push((file.to_owned(), None)),
            None if whole => read.push((file.to_owned(), None)),
            None => return None,
        }
    }
    join_parses(layers, &mut crossings);
    for crossing in &crossings {
        // A record whose parse is in a segment this merge did not open is not one it can read; the full reading can.
        let requests = requests_of(layers, crossing, internal).ok()?;
        let sites: Vec<Site> = requests.into_iter().map(|request| Site { package: request.package, specifier: request.specifier, line: request.line }).collect();
        read.push((crossing.file.to_owned(), (!sites.is_empty()).then_some(sites)));
    }
    Some(read)
}

pub(super) fn is_source(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].iter().any(|suffix| path.ends_with(suffix))
}

/// The workspace that owns each file, asked once per directory.
pub(super) struct Owning<'a> {
    owners: &'a [Owner],
    known: HashMap<String, Option<usize>>,
}

impl<'a> Owning<'a> {
    pub(super) fn new(owners: &'a [Owner]) -> Self { Self { owners, known: HashMap::new() } }

    pub(super) fn of(&mut self, path: &str) -> Option<&'a Owner> {
        let directory = crate::package_owners::parent(path);
        let owners = self.owners;
        let found = *self.known.entry(directory.to_owned()).or_insert_with(|| {
            owners.iter().enumerate().filter(|(_, owner)| owner.directory.is_empty() || directory == owner.directory || directory.starts_with(&format!("{}/", owner.directory)))
                .max_by_key(|(_, owner)| owner.directory.len()).map(|(at, _)| at)
        });
        found.map(|at| &owners[at])
    }
}

/// Whether a changed `node_modules` directory is one an owner resolves through.
pub(super) fn affects(changed: &HashSet<String>, owner: &Owner) -> bool {
    changed.iter().any(|path| {
        let Some(at) = path.find("node_modules") else { return false };
        let above = path[..at].trim_end_matches('/');
        above.is_empty() || owner.directory == above || owner.directory.starts_with(&format!("{above}/"))
    })
}

/// The lexicon at `path`, written whole beside itself and renamed into place, so a reader sees one or the other.
pub(super) fn publish(path: &Path, bytes: Vec<u8>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)
}
