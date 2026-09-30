//! Layer-2 journeys, prepared before anyone asks: every recorded case walked
//! once over the static call graph, kept as the call edges the walks placed and
//! each case's package flow, and written beside the source index.
//!
//! The prepared file is stamped with the digests of the recording and of the
//! index manifest it was built from, and with the walk that made it. Preparing
//! again with none of them changed keeps the file as it is; a question finding
//! one changed says the file is stale rather than answering from it
//! (`journeys_read.rs`).

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, HashMap, HashSet};

use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::index_chain::read_chain;
use crate::journey_read::Journey;
use crate::journeys_fold::{columns, fold, Packages};
use crate::journeys_graph::Graph;
use crate::journeys_record::{record, seeds};
use crate::journeys_roots::Helpers;
use crate::journeys_walk::{walk, Walked};
use crate::package_owners::{owner_of, owners, shown};
use crate::GitTree;

pub(crate) const FORMAT: u8 = 2;
/// The walk that prepared a file: the addon's version, and a revision moved
/// whenever the walk or the fold changes what it writes within one version.
/// A file another walk prepared is prepared again, never answered from.
pub(crate) const WALK: &str = concat!(env!("CARGO_PKG_VERSION"), "/walk.4");
/// The caller of a case's first placed function: the test itself.
pub(crate) const TEST: u32 = u32::MAX;
/// The package of a file no named manifest sits above.
pub(crate) const NO_PACKAGE: u32 = u32::MAX;
/// Each walk recurses once per placed call; a deep chain needs a deep stack.
const STACK: usize = 256 << 20;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Meta {
    pub format: u8,
    /// The walk that prepared the file, as [`WALK`] names it.
    #[serde(default)]
    pub walk: String,
    /// sha256 of the recording's journey file.
    pub recording: String,
    /// sha256 of the index manifest.
    pub index: String,
    /// The commit the recording ran at, when it names one.
    pub commit: Option<String>,
    /// Why the graph was parsed from the working tree rather than from the
    /// recorded commit; absent when the commit's tree was read.
    #[serde(default)]
    pub tree: Option<String>,
    pub cases: u32,
    /// Functions outside the test files the cases entered, summed per case.
    pub functions_entered: u64,
    /// Of those, the ones a walk placed on a route.
    pub placed: u64,
    /// Cases whose walk found no start in the relations.
    pub unstarted: u32,
    /// How many cases started at their own body, a shared suite's, or the
    /// test file's top level.
    pub starts: BTreeMap<String, u32>,
    /// Placed steps by how they are known.
    pub steps: BTreeMap<String, u64>,
    pub calls: u32,
    pub flows: u32,
    /// Specifiers the index did not answer, which the graph resolved itself.
    pub fell_back: u32,
    /// Call sites the static resolution missed that the recording placed, on
    /// the one entered function carrying the imported name.
    pub recorded: u32,
    /// Call sites whose imported name more than one entered function carried,
    /// left unplaced, and the cases they were ambiguous in.
    pub ambiguous: u32,
    pub ambiguous_cases: u32,
    /// The recording's and the index's size and modification time when they
    /// were digested, so a question finds them unmoved without hashing them.
    pub recording_stat: Option<Stat>,
    pub index_stat: Option<Stat>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct Stat {
    pub len: u64,
    /// Nanoseconds since the epoch.
    pub modified: u64,
}

impl Stat {
    pub(crate) fn of(path: &str) -> Option<Stat> {
        let metadata = std::fs::metadata(path).ok()?;
        let modified = metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos() as u64;
        Some(Stat { len: metadata.len(), modified })
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn digest_of(path: &str) -> Option<String> {
    std::fs::read(path).ok().map(|bytes| hex(&Sha256::digest(&bytes)))
}

/// The file at `path` is the one stamped: by size and modification time when
/// neither moved since the stamp was taken, and by digest when either did.
/// The stat is taken before the bytes are read, so a file replaced while it
/// was digested carries the older stat and is hashed again.
pub(crate) fn same(path: &str, stat: Option<&Stat>, digest: &str) -> bool {
    stat.is_some_and(|stat| Stat::of(path).as_ref() == Some(stat)) || digest_of(path).as_deref() == Some(digest)
}

/// The stamp a kept file carries, read without the rest of it; absent when
/// nothing is kept or another walk prepared it.
pub(crate) fn kept_meta(path: &str) -> Option<Meta> {
    let bytes = std::fs::read(path).ok()?;
    let decoded = crate::journey_columns::decode(&bytes, FORMAT).ok()?;
    serde_json::from_slice::<Meta>(&decoded.bytes("meta.json").ok()?).ok().filter(|meta| meta.walk == WALK)
}

#[napi(object)]
pub struct JourneysPrepared {
    /// The file was already stamped with this recording and this index.
    pub kept: bool,
    pub cases: u32,
    pub functions_entered: f64,
    pub placed: f64,
    pub calls: u32,
    pub flows: u32,
    pub fell_back: u32,
    /// Call sites the static resolution missed that the recording placed.
    pub recorded: u32,
    /// Call sites whose imported name several entered functions carried, left
    /// unplaced, and the cases they were ambiguous in.
    pub ambiguous: u32,
    pub ambiguous_cases: u32,
    /// The commit the recording ran at, when it names one.
    pub commit: Option<String>,
    /// Why the graph was parsed from the working tree rather than from the
    /// recorded commit.
    pub tree: Option<String>,
}

impl From<(&Meta, bool)> for JourneysPrepared {
    fn from((meta, kept): (&Meta, bool)) -> Self {
        JourneysPrepared {
            kept,
            cases: meta.cases,
            functions_entered: meta.functions_entered as f64,
            placed: meta.placed as f64,
            calls: meta.calls,
            flows: meta.flows,
            fell_back: meta.fell_back,
            recorded: meta.recorded,
            ambiguous: meta.ambiguous,
            ambiguous_cases: meta.ambiguous_cases,
            commit: meta.commit.clone(),
            tree: meta.tree.clone(),
        }
    }
}

/// The journeys kept at `out`, when this walk prepared them from this
/// recording and this index; `None` otherwise.
#[napi(catch_unwind)]
pub fn journeys_kept(index: String, recording: String, out: String) -> Option<JourneysPrepared> {
    let meta = kept_meta(&out)?;
    let fresh = same(&index, meta.index_stat.as_ref(), &meta.index) && same(&recording, meta.recording_stat.as_ref(), &meta.recording);
    fresh.then(|| (&meta, true).into())
}

fn listed(root: &str) -> Option<Vec<String>> {
    crate::git::git(root, &["-c", "core.quotePath=false", "ls-files", "-z"], None).map(|bytes| {
        bytes.split(|&byte| byte == 0).filter(|path| !path.is_empty()).map(|path| String::from_utf8_lossy(path).into_owned()).collect()
    })
}

/// The recording's commit as the caller read it, or why there is none.
#[napi(object)]
pub struct JourneysCommit {
    pub commit: Option<String>,
    /// Why the recording names no commit.
    pub unread: Option<String>,
}

/// Walks the recording at `recording` over the index at `index` and writes the
/// journeys to `out`, with git listing the checkout. `None` when there is no
/// source index.
#[napi(catch_unwind)]
pub fn prepare_journeys(
    root: String,
    index: String,
    recording: String,
    at: JourneysCommit,
    out: String,
) -> napi::Result<Option<JourneysPrepared>> {
    let listing = listed(&root);
    prepare(&root, &index, &recording, at, &out, listing.as_deref())
}

#[napi]
impl GitTree {
    /// Walk the recording over the index and write the journeys to `out`,
    /// carrying this listing of the checkout rather than asking git again.
    #[napi(catch_unwind)]
    pub fn prepare_journeys(
        &self,
        root: String,
        index: String,
        recording: String,
        at: JourneysCommit,
        out: String,
    ) -> napi::Result<Option<JourneysPrepared>> {
        prepare(&root, &index, &recording, at, &out, Some(self.listed()))
    }
}

fn prepare(
    root: &str,
    index: &str,
    recording: &str,
    at: JourneysCommit,
    out: &str,
    listing: Option<&[String]>,
) -> napi::Result<Option<JourneysPrepared>> {
    let fail = napi::Error::from_reason;
    // Stat before reading, so a file replaced while it is read is stamped as
    // the older one and found moved.
    let (recording_stat, index_stat) = (Stat::of(recording), Stat::of(index));
    let Some(chain) = read_chain(index).map_err(fail)? else { return Ok(None) };
    let index_digest = hex(&Sha256::digest(chain.published()));
    let bytes = std::fs::read(recording).map_err(|error| fail(format!("the recording at {recording} did not read: {error}")))?;
    let recording_digest = hex(&Sha256::digest(&bytes));
    let layers: Vec<Layer> = chain
        .segments
        .iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<_, _>>()
        .map_err(fail)?;
    let journey = Journey::of(recording, bytes).map_err(fail)?;
    let seeds = seeds(&journey).map_err(fail)?;
    // Git's listing owns which package each file is in. Without it, the files
    // the graph read are the listing.
    let known = listing.map(|listing| owners(root, listing));
    let unnamed = at.unread.unwrap_or_else(|| "the recording names no commit".to_owned());
    let graph = Graph::build(root, &layers, at.commit.as_deref().ok_or(unnamed.as_str()), &seeds);
    let record = record(&journey, &graph).map_err(fail)?;
    let pool = rayon::ThreadPoolBuilder::new().stack_size(STACK).build().map_err(|error| fail(error.to_string()))?;
    let helpers = Helpers::default();
    let walked: Vec<Walked> = pool.install(|| (0..record.tests.len()).into_par_iter().map(|case| walk(&graph, &record, &helpers, case)).collect());

    let owners = known.unwrap_or_else(|| owners(root, &graph.files));
    let (_, names) = shown(&owners);
    let directories: HashMap<&str, u32> =
        owners.packages.iter().enumerate().map(|(at, package)| (package.directory.as_str(), at as u32)).collect();
    let package: Vec<u32> = graph.files.iter().map(|file| owner_of(&owners, &directories, file).unwrap_or(NO_PACKAGE)).collect();
    let directories: Vec<String> = owners.packages.iter().map(|package| package.directory.clone()).collect();

    let mut folded = fold(&record, &walked, &package);
    let sites = |of: fn(&Walked) -> &Vec<u64>| walked.iter().flat_map(|walked| of(walked).iter().copied()).collect::<HashSet<u64>>().len() as u32;
    let meta = Meta {
        format: FORMAT,
        walk: WALK.to_owned(),
        recording: recording_digest,
        index: index_digest,
        commit: at.commit,
        tree: graph.tree.clone(),
        cases: record.tests.len() as u32,
        functions_entered: walked.iter().map(|walked| walked.entered as u64).sum(),
        placed: walked.iter().map(|walked| walked.placed as u64).sum(),
        unstarted: walked.iter().filter(|walked| walked.start.is_none()).count() as u32,
        starts: std::mem::take(&mut folded.starts),
        steps: std::mem::take(&mut folded.steps),
        calls: folded.calls.len() as u32,
        flows: folded.flows.len() as u32,
        fell_back: graph.fell_back,
        recorded: sites(|walked| &walked.recorded),
        ambiguous: sites(|walked| &walked.ambiguous),
        ambiguous_cases: walked.iter().filter(|walked| !walked.ambiguous.is_empty()).count() as u32,
        recording_stat,
        index_stat,
    };
    let packages = Packages { names: &names, directories: &directories, of: &package };
    let bytes = columns(&meta, &record, &graph, &folded, &packages).map_err(fail)?;
    let written = format!("{out}.{}", std::process::id());
    std::fs::write(&written, bytes)
        .and_then(|()| std::fs::rename(&written, out))
        .map_err(|error| fail(format!("{out} was not written: {error}")))?;
    Ok(Some((&meta, false).into()))
}
