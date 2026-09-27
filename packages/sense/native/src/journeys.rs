//! Layer-2 journeys, prepared before anyone asks: every recorded case walked
//! once over the static call graph, kept as the call edges the walks placed and
//! each case's package flow, and written beside the source index.
//!
//! The prepared file is stamped with the digests of the recording and of the
//! index manifest it was built from. Preparing again with neither changed
//! keeps the file as it is; a question finding either changed says the file is
//! stale rather than answering from it (`journeys_read.rs`).

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::index_chain::read_chain;
use crate::journey_columns::{encode, Column};
use crate::journey_read::Journey;
use crate::journeys_graph::Graph;
use crate::journeys_record::{record, seeds, Record};
use crate::journeys_roots::Helpers;
use crate::journeys_runner::Runner;
use crate::journeys_walk::{walk, Known, Tag, Walked};
use crate::package_owners::{owner_of, owners, shown};

pub(crate) const FORMAT: u8 = 1;
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
    /// sha256 of the recording's journey file.
    pub recording: String,
    /// sha256 of the index manifest.
    pub index: String,
    /// The commit the recording ran at, when it names one.
    pub commit: Option<String>,
    pub cases: u32,
    /// Functions outside the test files the cases entered, summed per case.
    pub functions_entered: u64,
    /// Of those, the ones a walk placed on a route.
    pub placed: u64,
    /// Cases whose walk found no start in the relations.
    pub unstarted: u32,
    /// How many cases started at their own body, a shared suite's, or the
    /// test file's top level.
    pub starts: HashMap<String, u32>,
    /// Placed steps by how they are known.
    pub steps: HashMap<String, u64>,
    pub calls: u32,
    pub flows: u32,
    /// Specifiers the index did not answer, which the graph resolved itself.
    pub fell_back: u32,
    /// Specifiers the runner's alias table answered.
    pub aliased: u32,
    pub runner: Option<RunnerStamp>,
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

/// The stamp a kept file carries, read without the rest of it.
pub(crate) fn kept_meta(path: &str) -> Option<Meta> {
    let bytes = std::fs::read(path).ok()?;
    let decoded = crate::journey_columns::decode(&bytes, FORMAT).ok()?;
    serde_json::from_slice(&decoded.bytes("meta.json").ok()?).ok()
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
    pub aliased: u32,
    /// Runner configs that did not load and aliases that did not compile.
    pub runner_unread: Vec<String>,
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
            aliased: meta.aliased,
            runner_unread: meta.runner.as_ref().map(|runner| runner.unread.clone()).unwrap_or_default(),
        }
    }
}

/// The stamp the runner's alias table is kept under: a digest the caller
/// computes over the files it read the table from, and those files.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerStamp {
    pub digest: String,
    pub files: Vec<String>,
    /// Configs the runner could not load and aliases that did not compile,
    /// each with why: the runner's answer for them is missing.
    #[serde(default)]
    pub unread: Vec<String>,
}

/// The files the kept journeys' runner stamp covers; `None` when nothing is
/// kept at `out` or it was prepared without a runner table.
#[napi(catch_unwind)]
pub fn journeys_runner_files(out: String) -> Option<Vec<String>> {
    kept_meta(&out).and_then(|meta| meta.runner).map(|runner| runner.files)
}

/// The journeys kept at `out`, when they were prepared from this recording,
/// this index and a runner table under `runner_digest`; `None` otherwise.
#[napi(catch_unwind)]
pub fn journeys_kept(index: String, recording: String, out: String, runner_digest: Option<String>) -> Option<JourneysPrepared> {
    let meta = kept_meta(&out)?;
    let index_digest = digest_of(&index)?;
    let recording_digest = digest_of(&recording)?;
    (meta.index == index_digest && meta.recording == recording_digest && meta.runner.as_ref().map(|runner| &runner.digest) == runner_digest.as_ref())
        .then(|| (&meta, true).into())
}

/// Walks the recording at `recording` over the index at `index` and writes the
/// journeys to `out`. `commit` is the commit the recording ran at; `runner` is
/// the test runner's alias table as `runner-aliases.ts` read it, with its stamp.
/// `None` when there is no source index.
#[napi(catch_unwind)]
pub fn prepare_journeys(
    root: String,
    index: String,
    recording: String,
    commit: Option<String>,
    out: String,
    runner: Option<String>,
) -> napi::Result<Option<JourneysPrepared>> {
    let fail = napi::Error::from_reason;
    // Stat before reading, so a file replaced while it is read is stamped as
    // the older one and found moved.
    let (recording_stat, index_stat) = (Stat::of(&recording), Stat::of(&index));
    let Some(chain) = read_chain(&index).map_err(fail)? else { return Ok(None) };
    let index_digest = hex(&Sha256::digest(chain.published()));
    let recording_digest = digest_of(&recording).ok_or_else(|| fail(format!("the recording at {recording} did not read")))?;
    let layers: Vec<Layer> = chain
        .segments
        .iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<_, _>>()
        .map_err(fail)?;
    let journey = Journey::open(&recording).map_err(fail)?;
    let seeds = seeds(&journey).map_err(fail)?;
    let listed = crate::git::git(&root, &["-c", "core.quotePath=false", "ls-files", "-z"], None).map(|bytes| {
        bytes.split(|&byte| byte == 0).filter(|path| !path.is_empty()).map(|path| String::from_utf8_lossy(path).into_owned()).collect::<Vec<String>>()
    });
    let tracked = listed.clone().unwrap_or_default();
    let mut stamp: Option<RunnerStamp> = None;
    let runner = match runner {
        Some(json) => {
            let owners = owners(&root, &tracked);
            let packages = owners.packages.iter().map(|package| (package.name.clone(), package.directory.clone())).collect();
            let table = Runner::read(&json, packages, tracked.iter().cloned().collect()).map_err(fail)?;
            let mut read: RunnerStamp = serde_json::from_str(&json).map_err(|error| fail(format!("the runner's alias table has no stamp: {error}")))?;
            read.unread.extend(table.unread.iter().cloned());
            stamp = Some(read);
            Some(table)
        }
        None => None,
    };
    let graph = Graph::build(&root, &layers, commit.as_deref(), &seeds, runner.as_ref());
    let record = record(&journey, &graph).map_err(fail)?;
    let pool = rayon::ThreadPoolBuilder::new().stack_size(STACK).build().map_err(|error| fail(error.to_string()))?;
    let helpers = Helpers::default();
    let walked: Vec<Walked> = pool.install(|| (0..record.tests.len()).into_par_iter().map(|case| walk(&graph, &record, &helpers, case)).collect());

    // Without git's listing, the files the graph read are the listing.
    let listed = listed.unwrap_or_else(|| graph.files.clone());
    let owners = owners(&root, &listed);
    let (_, names) = shown(&owners);
    let directories: HashMap<&str, u32> =
        owners.packages.iter().enumerate().map(|(at, package)| (package.directory.as_str(), at as u32)).collect();
    let package: Vec<u32> = graph.files.iter().map(|file| owner_of(&owners, &directories, file).unwrap_or(NO_PACKAGE)).collect();
    let directories: Vec<String> = owners.packages.iter().map(|package| package.directory.clone()).collect();

    let mut folded = fold(&record, &walked, &package);
    let meta = Meta {
        format: FORMAT,
        recording: recording_digest,
        index: index_digest,
        commit,
        cases: record.tests.len() as u32,
        functions_entered: walked.iter().map(|walked| walked.entered as u64).sum(),
        placed: walked.iter().map(|walked| walked.placed as u64).sum(),
        unstarted: walked.iter().filter(|walked| walked.start.is_none()).count() as u32,
        starts: std::mem::take(&mut folded.starts),
        steps: std::mem::take(&mut folded.steps),
        calls: folded.calls.len() as u32,
        flows: folded.flows.len() as u32,
        fell_back: graph.fell_back,
        aliased: graph.aliased,
        runner: stamp,
        recording_stat,
        index_stat,
    };
    let bytes = columns(&meta, &record, &graph, &folded, &names, &directories).map_err(fail)?;
    let written = format!("{out}.{}", std::process::id());
    std::fs::write(&written, bytes)
        .and_then(|()| std::fs::rename(&written, &out))
        .map_err(|error| fail(format!("{out} was not written: {error}")))?;
    Ok(Some((&meta, false).into()))
}

/// Every case's walk, folded: each call edge with the cases that placed it and
/// the best way it is known, and each distinct package flow.
struct Folded {
    /// (from region or TEST, to region) → (cases, tag, how).
    calls: Vec<((u32, u32), (u32, Tag, Known))>,
    /// Package sequence, cases, example case.
    flows: Vec<(Vec<u32>, u32, u32)>,
    case_flow: Vec<u32>,
    starts: HashMap<String, u32>,
    steps: HashMap<String, u64>,
}

fn fold(record: &Record, walked: &[Walked], package: &[u32]) -> Folded {
    let mut calls: HashMap<(u32, u32), (u32, Tag, Known)> = HashMap::new();
    let mut flows: HashMap<Vec<u32>, usize> = HashMap::new();
    let mut listed: Vec<(Vec<u32>, u32, u32)> = Vec::new();
    let mut case_flow = Vec::with_capacity(walked.len());
    let mut starts: HashMap<String, u32> = HashMap::new();
    let mut steps: HashMap<String, u64> = HashMap::new();
    for (case, walk) in walked.iter().enumerate() {
        if let Some(start) = walk.start {
            *starts.entry(start.name().to_owned()).or_default() += 1;
        }
        let mut stack: Vec<Option<u32>> = Vec::new();
        let mut took: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
        let mut seq = vec![package[record.tests[case].0 as usize]];
        for step in &walk.steps {
            stack.truncate(step.depth as usize);
            stack.push(step.region);
            if !seq.contains(&package[step.file as usize]) {
                seq.push(package[step.file as usize]);
            }
            let Some(to) = step.region else { continue };
            let how = if step.tag == Tag::Inferred { step.known.name() } else { step.tag.name() };
            *steps.entry(how.to_owned()).or_default() += 1;
            let from = stack[..stack.len() - 1].iter().rev().find_map(|region| *region).unwrap_or(TEST);
            if took.insert((from, to)) {
                calls
                    .entry((from, to))
                    .and_modify(|held| {
                        held.0 += 1;
                        if step.tag > held.1 {
                            (held.1, held.2) = (step.tag, step.known);
                        }
                    })
                    .or_insert((1, step.tag, step.known));
            }
        }
        let at = *flows.entry(seq.clone()).or_insert_with(|| {
            listed.push((seq, 0, case as u32));
            listed.len() - 1
        });
        listed[at].1 += 1;
        case_flow.push(at as u32);
    }
    let mut calls: Vec<_> = calls.into_iter().collect();
    calls.sort_unstable_by_key(|(key, _)| *key);
    Folded { calls, flows: listed, case_flow, starts, steps }
}

fn columns<'a>(meta: &Meta, record: &'a Record, graph: &'a Graph, folded: &Folded, names: &'a [String], directories: &'a [String]) -> Result<Vec<u8>, String> {
    let mut strings: Vec<&str> = Vec::new();
    let mut ids: HashMap<&str, u32> = HashMap::new();
    let mut id = |text: &'a str| -> u32 {
        *ids.entry(text).or_insert_with(|| {
            strings.push(text);
            strings.len() as u32 - 1
        })
    };
    let region_file: Vec<u32> = record.regions.iter().map(|region| id(&graph.files[region.file as usize])).collect();
    let region_kind: Vec<u32> = record.regions.iter().map(|region| id(region.kind)).collect();
    let region_name: Vec<u32> = record.regions.iter().map(|region| id(region.name)).collect();
    let test_file: Vec<u32> = record.tests.iter().map(|test| id(&graph.files[test.0 as usize])).collect();
    let test_name: Vec<u32> = record.tests.iter().map(|test| id(test.1)).collect();
    let package_name: Vec<u32> = names.iter().map(|name| id(name)).collect();
    let package_directory: Vec<u32> = directories.iter().map(|directory| id(directory)).collect();
    let mut blob = Vec::new();
    let mut offsets = vec![0u32];
    for text in &strings {
        blob.extend_from_slice(text.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut flow_packages = Vec::new();
    let mut flow_offsets = vec![0u32];
    for (seq, _, _) in &folded.flows {
        flow_packages.extend_from_slice(seq);
        flow_offsets.push(flow_packages.len() as u32);
    }
    let meta = serde_json::to_vec(meta).map_err(|error| error.to_string())?;
    encode(
        vec![
            Column::Bytes("meta.json", meta),
            Column::Blob("strings.blob", blob, offsets.clone()),
            Column::Words("strings.off", offsets),
            Column::Words("regions.file", region_file),
            Column::Words("regions.kind", region_kind),
            Column::Words("regions.name", region_name),
            Column::Words("regions.start", record.regions.iter().map(|region| region.start).collect()),
            Column::Words("regions.end", record.regions.iter().map(|region| region.end).collect()),
            Column::Words("regions.cases", record.regions.iter().map(|region| region.cases).collect()),
            Column::Bytes("regions.loaded", record.regions.iter().map(|region| u8::from(region.loaded)).collect()),
            Column::Words("calls.from", folded.calls.iter().map(|((from, _), _)| *from).collect()),
            Column::Words("calls.to", folded.calls.iter().map(|((_, to), _)| *to).collect()),
            Column::Words("calls.cases", folded.calls.iter().map(|(_, (cases, _, _))| *cases).collect()),
            Column::Bytes("calls.tag", folded.calls.iter().map(|(_, (_, tag, _))| *tag as u8).collect()),
            Column::Bytes("calls.how", folded.calls.iter().map(|(_, (_, _, known))| known.code()).collect()),
            Column::Words("flows.packages", flow_packages),
            Column::Words("flows.off", flow_offsets),
            Column::Words("flows.cases", folded.flows.iter().map(|flow| flow.1).collect()),
            Column::Words("flows.example", folded.flows.iter().map(|flow| flow.2).collect()),
            Column::Words("cases.flow", folded.case_flow.clone()),
            Column::Words("tests.file", test_file),
            Column::Words("tests.name", test_name),
            Column::Words("packages.name", package_name),
            Column::Words("packages.directory", package_directory),
        ],
        FORMAT,
    )
}
