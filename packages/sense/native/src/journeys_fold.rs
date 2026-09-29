//! Every case's walk folded into the columns the prepared journeys file holds:
//! the call edges the walks placed, each case's package order, and, from the
//! recording itself rather than from the walks, how many cases entered each
//! file and each package.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::journey_columns::{encode, Column};
use crate::journeys::{Meta, FORMAT, NO_PACKAGE, TEST};
use crate::journeys_graph::Graph;
use crate::journeys_record::Record;
use crate::journeys_walk::{Known, Tag, Walked};

/// Every case's walk, folded: each call edge with the cases that placed it and
/// the best way it is known, and each distinct package flow — the packages in
/// the order the walk placed calls into them, starting at the test file's.
pub(crate) struct Folded {
    /// (from region or TEST, to region) → (the cases that placed it, in case
    /// order, tag, how).
    pub calls: Vec<((u32, u32), (Vec<u32>, Tag, Known))>,
    /// Package order, cases, example case.
    pub flows: Vec<(Vec<u32>, u32, u32)>,
    pub case_flow: Vec<u32>,
    pub starts: BTreeMap<String, u32>,
    pub steps: BTreeMap<String, u64>,
}

pub(crate) fn fold(record: &Record, walked: &[Walked], package: &[u32]) -> Folded {
    let mut calls: HashMap<(u32, u32), (Vec<u32>, Tag, Known)> = HashMap::new();
    let mut flows: HashMap<Vec<u32>, usize> = HashMap::new();
    let mut listed: Vec<(Vec<u32>, u32, u32)> = Vec::new();
    let mut case_flow = Vec::with_capacity(walked.len());
    let mut starts: BTreeMap<String, u32> = BTreeMap::new();
    let mut steps: BTreeMap<String, u64> = BTreeMap::new();
    for (case, walk) in walked.iter().enumerate() {
        if let Some(start) = walk.start {
            *starts.entry(start.name().to_owned()).or_default() += 1;
        }
        let mut stack: Vec<Option<u32>> = Vec::new();
        let mut took: HashSet<(u32, u32)> = HashSet::new();
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
                        held.0.push(case as u32);
                        if step.tag > held.1 {
                            (held.1, held.2) = (step.tag, step.known);
                        }
                    })
                    .or_insert_with(|| (vec![case as u32], step.tag, step.known));
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

/// How many cases entered a function of each file and of each package, as the
/// recording has it: a case the walk placed nothing for still ran what it ran.
/// Per package, the one no named manifest sits above last.
pub(crate) fn entered(record: &Record, package: &[u32], packages: usize) -> (Vec<(u32, u32)>, Vec<u32>) {
    let mut files: HashMap<u32, u32> = HashMap::new();
    let mut through = vec![0u32; packages + 1];
    for regions in &record.entered {
        let mut reached: Vec<u32> =
            regions.iter().map(|&region| &record.regions[region as usize]).filter(|region| region.kind != "module").map(|region| region.file).collect();
        reached.sort_unstable();
        reached.dedup();
        let mut owned: Vec<usize> = reached.iter().map(|&file| package[file as usize]).map(|at| if at == NO_PACKAGE { packages } else { at as usize }).collect();
        owned.sort_unstable();
        owned.dedup();
        for file in reached {
            *files.entry(file).or_default() += 1;
        }
        for at in owned {
            through[at] += 1;
        }
    }
    let mut files: Vec<(u32, u32)> = files.into_iter().collect();
    files.sort_unstable();
    (files, through)
}

pub(crate) struct Packages<'a> {
    pub names: &'a [String],
    pub directories: &'a [String],
    /// Per graph file: its package, or `NO_PACKAGE`.
    pub of: &'a [u32],
}

pub(crate) fn columns<'a>(meta: &Meta, record: &'a Record, graph: &'a Graph, folded: &Folded, packages: &Packages<'a>) -> Result<Vec<u8>, String> {
    let (files, through) = entered(record, packages.of, packages.names.len());
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
    let package_name: Vec<u32> = packages.names.iter().map(|name| id(name)).collect();
    let package_directory: Vec<u32> = packages.directories.iter().map(|directory| id(directory)).collect();
    let file_name: Vec<u32> = files.iter().map(|&(file, _)| id(&graph.files[file as usize])).collect();
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
    // Who placed each call, so a question about some of the cases counts the
    // calls those cases placed rather than every case's.
    let mut who = Vec::new();
    let mut who_offsets = vec![0u32];
    for (_, (cases, _, _)) in &folded.calls {
        who.extend_from_slice(cases);
        who_offsets.push(who.len() as u32);
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
            Column::Words("calls.cases", folded.calls.iter().map(|(_, (cases, _, _))| cases.len() as u32).collect()),
            Column::Words("calls.who", who),
            Column::Words("calls.who.off", who_offsets),
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
            Column::Words("packages.cases", through),
            Column::Words("files.file", file_name),
            Column::Words("files.cases", files.iter().map(|&(_, cases)| cases).collect()),
        ],
        FORMAT,
    )
}
