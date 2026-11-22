use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::journey_format::{self, Gaps};
use crate::{case_shard, journey_columns, journey_output, order};
use crate::journal_scan::Visitor;
use crate::journey_journal::{self, CaseRun, ModuleId};
use crate::journey_record::Module;
use crate::record_layout::LAYOUT;

#[path = "journey_fold.rs"]
pub(crate) mod journey_fold;
#[path = "case_run.rs"]
pub(crate) mod case_run;
#[path = "case_layer_sets.rs"]
pub(crate) mod case_layer_sets;
#[path = "case_layer_landing.rs"]
pub(crate) mod case_layer_landing;
#[path = "case_layer.rs"]
pub(crate) mod case_layer;
#[path = "case_layer_before.rs"]
pub(crate) mod case_layer_before;
#[path = "case_layer_lines.rs"]
pub(crate) mod case_layer_lines;
#[path = "case_layer_modules.rs"]
pub(crate) mod case_layer_modules;
#[path = "case_layer_napi.rs"]
pub(crate) mod case_layer_napi;

use crate::case_charge::{replay_run, Charge, Charged};
use journey_fold::{fold, Folded, Placed};

const DEFAULT_BUDGET: usize = 512 * 1_048_576;

#[napi(object)]
pub struct JourneyFold {
    pub bytes: Buffer,
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub passes: u32,
    /// Modules a case ran that no record holds: a change there selects nothing.
    pub unrecorded: Vec<String>,
    /// Part files that ran code under no journey a case handed out.
    pub unclaimed: Vec<String>,
    /// Heads that wrote parts in the run before and none in this one; absent
    /// when there was no run before to compare with.
    pub silent: Option<Vec<String>>,
}

#[napi(object)]
pub struct JourneyFoldResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub passes: u32,
    /// Modules a case ran that no record holds: a change there selects nothing.
    pub unrecorded: Vec<String>,
    /// Part files that ran code under no journey a case handed out.
    pub unclaimed: Vec<String>,
    /// Heads that wrote parts in the run before and none in this one; absent
    /// when there was no run before to compare with.
    pub silent: Option<Vec<String>>,
}

/// Every module id the run's cases and parts name, for the caller to cut again.
#[napi(catch_unwind)]
pub fn journey_module_ids(case_directory: String, root: String, parts: Option<Vec<String>>) -> napi::Result<Vec<String>> {
    let run = journey_journal::inspect(Path::new(&case_directory), Path::new(&root), parts.as_deref().unwrap_or_default())
        .map_err(napi::Error::from_reason)?;
    let mut ids: Vec<String> = run.wanted.into_iter().chain(run.part_wanted).collect::<HashSet<_>>().into_iter().collect();
    ids.sort_unstable_by(|left, right| order::code_unit(left, right));
    Ok(ids)
}

/// Read, fold, and encode one run's case journals without crossing per-row objects into V8.
#[napi(catch_unwind)]
pub fn fold_journey(
    case_directory: String,
    root: String,
    modules: Vec<Module>,
    budget_megabytes: Option<u32>,
) -> napi::Result<JourneyFold> {
    let answered = answer(&case_directory, &root, modules, budget_megabytes, &[], None)
    .map_err(napi::Error::from_reason)?;
    Ok(JourneyFold {
        bytes: answered.folded.bytes.into(),
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        unrecorded: answered.gaps.unrecorded,
        unclaimed: answered.gaps.unclaimed,
        silent: answered.gaps.silent,
    })
}

struct FoldAnswer {
    folded: Folded,
    tests: u32,
    gaps: Gaps,
}

fn answer(
    case_directory: &str,
    root: &str,
    modules: Vec<Module>,
    budget_megabytes: Option<u32>,
    parts: &[String],
    previous: Option<&str>,
) -> Result<FoldAnswer, String> {
    let run = journey_journal::inspect(Path::new(case_directory), Path::new(root), parts)?;
    let mut found = HashMap::with_capacity(modules.len());
    for module in modules {
        if run.wanted.contains(&module.id) || run.part_wanted.contains(&module.id) {
            found.insert(module.id.clone(), module);
        }
    }
    let silent = previous.and_then(previous_heads).map(|before| {
        before.into_iter().filter(|head| run.heads.binary_search_by(|now| order::code_unit(now, head)).is_err()).collect()
    });
    let gaps = Gaps {
        unrecorded: unrecorded(&run, &found)?,
        unclaimed: run.unclaimed.clone(),
        heads: run.heads.clone(),
        silent,
    };
    let placed = found.into_values().map(|module| Placed { module, ordinals: None }).collect();
    // FIXME: the Jest journey artifact folds without a `CaseShape`, so it drops each case's lines (spec 0100).
    let folded = fold(
        &run,
        placed,
        budget_megabytes.map_or(DEFAULT_BUDGET, |value| value as usize * 1_048_576),
        None,
        |modules, _, sets| journey_format::encode(&run.tests, &journey_format::CaseExtras::default(), modules, sets, Some(&gaps)),
    )?;
    Ok(FoldAnswer {
        folded,
        tests: run.tests.len() as u32,
        gaps,
    })
}

/// The heads the artifact already at `output` saw write parts. None when
/// nothing is there, or what is there does not carry them: with no run before
/// to compare with, no head can be said to have gone quiet.
fn previous_heads(output: &str) -> Option<Vec<String>> {
    let bytes = fs::read(output).ok()?;
    let decoded = journey_columns::decode(&bytes, LAYOUT.cases.format).ok()?;
    let strings = case_shard::strings(&decoded).ok()?;
    Some(journey_format::read_gaps(&decoded, &strings).ok()??.heads)
}

/// The modules a case ran that no record holds, by name: what ran there is
/// in no region, so a change to them selects nothing. The journals are
/// replayed again only when such a module exists.
fn unrecorded(run: &CaseRun, found: &HashMap<ModuleId, Module>) -> Result<Vec<String>, String> {
    let missing: HashSet<ModuleId> = run
        .wanted
        .iter()
        .chain(&run.part_wanted)
        .filter(|id| !found.contains_key(*id))
        .cloned()
        .collect();
    if missing.is_empty() {
        return Ok(Vec::new());
    }
    let mut visitor = UnrecordedVisitor { charge: Charge::new(run), missing: &missing, named: HashSet::new() };
    replay_run(run, &mut visitor)?;
    let mut named: Vec<String> = visitor.named.into_iter().collect();
    named.sort_unstable_by(|left, right| order::code_unit(left, right));
    Ok(named)
}

/// Fold one run and write its compressed artifact without transferring it through V8.
///
/// `parts` are directories of frames written beyond a fence, joined to the
/// cases by journey id; `modules` are every module the cases and parts name,
/// as [`journey_module_ids`] listed them, cut again by the caller.
#[napi(catch_unwind)]
pub fn fold_journey_to(
    case_directory: String,
    root: String,
    modules: Vec<Module>,
    output: String,
    budget_megabytes: Option<u32>,
    parts: Option<Vec<String>>,
) -> napi::Result<JourneyFoldResult> {
    let answered = answer(
        &case_directory,
        &root,
        modules,
        budget_megabytes,
        parts.as_deref().unwrap_or_default(),
        Some(&output),
    )
    .map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.folded.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyFoldResult {
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        unrecorded: answered.gaps.unrecorded,
        unclaimed: answered.gaps.unclaimed,
        silent: answered.gaps.silent,
    })
}

/// The modules no record holds that a frame charged to a case named.
struct UnrecordedVisitor<'a> {
    charge: Charge<'a>,
    missing: &'a HashSet<ModuleId>,
    named: HashSet<ModuleId>,
}

impl<'a> Charged<'a> for UnrecordedVisitor<'a> {
    fn charge(&mut self) -> &mut Charge<'a> {
        &mut self.charge
    }
}

impl Visitor for UnrecordedVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.charge.test(packed)
    }

    fn wants(&mut self, id: &ModuleId, _cut: bool) -> bool {
        if self.missing.contains(id) && !self.charge.nobody() {
            self.named.insert(id.clone());
        }
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32], _: Option<&[u32]>) {}
}
