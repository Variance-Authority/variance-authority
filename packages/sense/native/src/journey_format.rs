use std::collections::HashMap;

use crate::case_id;
use crate::case_said;
use crate::crossing_sets::SetPool;
use crate::journey_columns::{self, Column};
use crate::journey_journal::Test;
use crate::journey_record::{Module, NO_OWNER};
use crate::order;
use crate::record_layout::LAYOUT;

// The index's version is `LAYOUT.cases.format`. Version 3 carries load time
// as one flag per region rather than as the set of tests that loaded it. A
// region that ran while its module evaluated ran for whoever imported the
// module first, so the set named an import order and not a test; the import
// graph answers that question, and the flag says when to ask it.

pub struct EncodedModule<'a> {
    pub module: &'a Module,
    pub called: &'a [u32],
    /// Whether the region ran while its module evaluated, in any test file.
    pub loaded: &'a [bool],
}

/// What a finalize could not charge to a case, carried in the artifact it
/// writes so a reader in a later process sees the finalize's own answer.
///
/// An artifact written before these were carried has none of their columns,
/// which reads as not measured rather than as nothing found.
#[derive(Clone, Default)]
pub struct Gaps {
    /// Modules a case ran that no record holds.
    pub unrecorded: Vec<String>,
    /// Part files that ran code under no journey a case handed out.
    pub unclaimed: Vec<String>,
    /// Heads that wrote at least one part in this run.
    pub heads: Vec<String>,
    /// Heads that wrote parts in the run before and none in this one; absent
    /// when there was no run before to compare with.
    pub silent: Option<Vec<String>>,
}

/// Each region's owner among its module's regions, as `encodeSetExecutionIndex` writes it.
pub const OWNER: &str = "blocks.owner";

const UNRECORDED: &str = "gaps.unrecorded";
const UNCLAIMED: &str = "gaps.unclaimed";
const HEADS: &str = "gaps.heads";
const SILENT: &str = "gaps.silent";

/// The gaps an artifact carries, or none when it was written without them.
pub fn read_gaps(decoded: &journey_columns::Decoded, strings: &[String]) -> Result<Option<Gaps>, String> {
    if !decoded.has(UNRECORDED) {
        return Ok(None);
    }
    let named = |column: &str| -> Result<Vec<String>, String> {
        decoded
            .words(column)?
            .into_iter()
            .map(|id| strings.get(id as usize).cloned().ok_or_else(|| format!("{column} names no string")))
            .collect()
    };
    Ok(Some(Gaps {
        unrecorded: named(UNRECORDED)?,
        unclaimed: named(UNCLAIMED)?,
        heads: named(HEADS)?,
        silent: if decoded.has(SILENT) { Some(named(SILENT)?) } else { None },
    }))
}

/// What a case carries beyond its name and how it settled, each column written
/// only where some case has it, and one row a case where it is written.
#[derive(Default)]
pub struct CaseExtras {
    /// Each case's duration in whole milliseconds; empty where no case was timed.
    pub durations: Vec<Option<u32>>,
    /// Each case's lines as stored, empty for a case that recorded none; no
    /// rows where no case recorded any.
    pub lines: Vec<Vec<u8>>,
    /// Whether `tests.duration` is written even where no case was timed. A
    /// record's case index always carries it, so `combine` sets it; a journey
    /// artifact carries it only where a case was timed, so `journeys stitch`
    /// does not.
    pub always_timed: bool,
}

pub fn encode(
    tests: &[Test],
    extras: &CaseExtras,
    modules: &[EncodedModule<'_>],
    sets: &mut SetPool,
    gaps: Option<&Gaps>,
) -> Result<Vec<u8>, String> {
    let timed = extras.always_timed || extras.durations.iter().any(Option::is_some);
    let lined = extras.lines.iter().any(|lines| !lines.is_empty());
    if (timed && extras.durations.len() != tests.len()) || (lined && extras.lines.len() != tests.len()) {
        return Err("case columns disagree with the cases".to_owned());
    }
    let mut strings = Vec::new();
    let heard: Vec<Option<&case_said::Heard>> = tests.iter().map(|test| test.heard.as_ref()).collect();
    let heard = case_said::lay(&heard, sets);
    for test in tests {
        strings.extend([test.id.clone(), test.file.clone(), test.name.clone()]);
    }
    // Carried only when every case has one, so a stitch never joins half its cases by it.
    let runners: Option<Vec<&str>> = tests.iter().map(|test| test.runner.as_deref()).collect();
    strings.extend(runners.iter().flatten().map(|runner| (*runner).to_owned()));
    // Carried when any case has one: a case no named project ran is `UNNAMED`.
    let named = tests.iter().any(|test| test.project.is_some());
    strings.extend(tests.iter().filter_map(|test| test.project.clone()));
    for held in modules {
        strings.push(held.module.file.clone());
        for block in &held.module.blocks {
            strings.extend([block.kind.clone(), block.name.clone(), block.path.clone()]);
        }
    }
    if let Some(gaps) = gaps {
        strings.extend(gaps.unrecorded.iter().cloned());
        strings.extend(gaps.unclaimed.iter().cloned());
        strings.extend(gaps.heads.iter().cloned());
        strings.extend(gaps.silent.iter().flatten().cloned());
    }
    strings.sort_unstable_by(|left, right| order::code_unit(left, right));
    strings.dedup();
    let ids: HashMap<&str, u32> = strings
        .iter()
        .enumerate()
        .map(|(at, value)| (value.as_str(), at as u32))
        .collect();
    let id = |value: &str| ids[value];

    let mut string_blob = Vec::new();
    let mut string_off = vec![0];
    for value in &strings {
        string_blob.extend_from_slice(value.as_bytes());
        string_off.push(string_blob.len() as u32);
    }
    let mut module_file = Vec::with_capacity(modules.len());
    let mut module_blocks = Vec::with_capacity(modules.len() + 1);
    let mut block_kind = Vec::new();
    let mut block_name = Vec::new();
    let mut block_path = Vec::new();
    let mut block_start = Vec::new();
    let mut block_end = Vec::new();
    let mut block_source = Vec::new();
    let mut block_called = Vec::new();
    let mut block_loaded = Vec::new();
    // Written when any module knows its owners; a module that does not names none.
    let mut block_owner = modules.iter().any(|held| held.module.owners.is_some()).then(Vec::new);
    for held in modules {
        module_file.push(id(&held.module.file));
        module_blocks.push(block_kind.len() as u32);
        if let Some(column) = block_owner.as_mut() {
            let count = held.module.blocks.len();
            match &held.module.owners {
                Some(owners) => {
                    if owners.len() != count {
                        return Err(format!("{} names {} owners for {count} regions", held.module.file, owners.len()));
                    }
                    if owners.iter().enumerate().any(|(at, owner)| *owner != NO_OWNER && *owner as usize >= at) {
                        return Err(format!("{} names an owner after its region", held.module.file));
                    }
                    column.extend_from_slice(owners);
                }
                None => column.extend(std::iter::repeat_n(NO_OWNER, count)),
            }
        }
        for (at, block) in held.module.blocks.iter().enumerate() {
            block_kind.push(id(&block.kind));
            block_name.push(id(&block.name));
            block_path.push(id(&block.path));
            block_start.push(block.start_line);
            block_end.push(block.end_line);
            block_source.push(u8::from(block.source));
            block_called.push(held.called[at]);
            block_loaded.push(u8::from(held.loaded[at]));
        }
    }
    module_blocks.push(block_kind.len() as u32);

    // The order `execution-set-format.ts` writes, so an index this writes is
    // the bytes that writer gives for the same run: the cases and what each
    // carries, the modules and their regions, then the sets. Columns only this
    // writer spells follow.
    let mut columns = vec![
        Column::Blob("strings.blob", string_blob, string_off.clone()),
        Column::Words("strings.off", string_off),
        Column::Words("tests.id", tests.iter().map(|test| id(&test.id)).collect()),
        Column::Words("tests.file", tests.iter().map(|test| id(&test.file)).collect()),
        Column::Words("tests.name", tests.iter().map(|test| id(&test.name)).collect()),
        Column::Bytes("tests.stopped", tests.iter().map(|test| test.settled).collect()),
    ];
    let cases = &LAYOUT.cases;
    if timed {
        let words = extras.durations.iter().map(|duration| duration.unwrap_or(LAYOUT.coverage.no_duration)).collect();
        columns.push(Column::Words(cases.duration.as_str(), words));
    }
    for (section, laid) in case_said::SECTIONS.into_iter().zip(heard) {
        if let Some(laid) = laid {
            columns.push(Column::Bytes(section, laid));
        }
    }
    if lined {
        let mut blob = Vec::new();
        let mut offsets = vec![0_u32];
        for lines in &extras.lines {
            blob.extend_from_slice(lines);
            offsets.push(u32::try_from(blob.len()).map_err(|_| "case lines exceed 4 GiB".to_owned())?);
        }
        columns.push(Column::Blob(cases.lines.as_str(), blob, offsets.clone()));
        columns.push(Column::Words(cases.lines_offsets.as_str(), offsets));
    }
    columns.extend([
        Column::Words("modules.file", module_file),
        Column::Words("modules.blocks", module_blocks),
        Column::Words("blocks.kind", block_kind),
        Column::Words("blocks.name", block_name),
        Column::Words("blocks.path", block_path),
        Column::Words("blocks.start", block_start),
        Column::Words("blocks.end", block_end),
        Column::Bytes("blocks.source", block_source),
        Column::Words("blocks.calledSet", block_called),
        Column::Bytes("blocks.loaded", block_loaded),
    ]);
    if let Some(owners) = block_owner {
        columns.push(Column::Words(OWNER, owners));
    }
    columns.push(Column::Blob("sets.blob", sets.bytes().to_vec(), sets.offsets().to_vec()));
    columns.push(Column::Words("sets.off", sets.offsets().to_vec()));
    if let Some(runners) = runners.filter(|runners| !runners.is_empty()) {
        columns.push(Column::Words(case_id::COLUMN, runners.into_iter().map(id).collect()));
    }
    if named {
        let words = tests.iter().map(|test| test.project.as_deref().map_or(case_id::UNNAMED, id)).collect();
        columns.push(Column::Words(case_id::PROJECT_COLUMN, words));
    }
    if let Some(gaps) = gaps {
        let ids = |names: &[String]| names.iter().map(|name| id(name)).collect::<Vec<u32>>();
        columns.push(Column::Words(UNRECORDED, ids(&gaps.unrecorded)));
        columns.push(Column::Words(UNCLAIMED, ids(&gaps.unclaimed)));
        columns.push(Column::Words(HEADS, ids(&gaps.heads)));
        if let Some(silent) = &gaps.silent {
            columns.push(Column::Words(SILENT, ids(silent)));
        }
    }
    journey_columns::encode(columns, LAYOUT.cases.format)
}
