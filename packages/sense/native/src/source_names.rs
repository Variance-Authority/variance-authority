//! Batched discovery predicates over native source columns; only matching evidence leaves the index.

// compass: variance-authority.reach.source-index

use napi_derive::napi;
use regex::{Regex, RegexBuilder};
use rustc_hash::FxHashSet;

use crate::chain_lookup::fold;
use crate::compact::Layer;
use crate::package_graph::{join_all_parses, Crossing};
use crate::package_owners::NO_OWNER;

#[derive(Debug)]
#[napi(object)]
pub struct NamesOperand {
    pub kind: String,
    pub pattern: Option<String>,
    pub specifier: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug)]
#[napi(object)]
pub struct NamesAnswer {
    pub unread: u32,
    pub groups: Vec<NamesGroup>,
}

#[derive(Debug)]
#[napi(object)]
pub struct NamesGroup {
    pub files: Vec<NamesFile>,
}

#[derive(Debug)]
#[napi(object)]
pub struct NamesFile {
    pub file: String,
    pub evidence: Vec<NameEvidence>,
}

#[derive(Debug)]
#[napi(object)]
pub struct NameEvidence {
    pub line: u32,
    pub name: Option<String>,
    pub from: Option<String>,
    pub local: Option<String>,
    pub through: Option<String>,
}

enum Predicate {
    Declares(Regex),
    Imports { specifier: String, name: Option<String>, bare: bool },
}

impl Predicate {
    fn of(operand: NamesOperand) -> Result<Self, String> {
        match operand.kind.as_str() {
            "declares" => {
                let pattern = operand.pattern.ok_or("`declares` needs a pattern")?;
                RegexBuilder::new(&pattern).case_insensitive(true).build()
                    .map(Self::Declares)
                    .map_err(|error| format!("`declares` is not a regular expression: {error}."))
            }
            "imports" => {
                let specifier = operand.specifier.ok_or("`imports` needs a specifier")?;
                let bare = !specifier.starts_with('.') && !specifier.starts_with('/');
                Ok(Self::Imports { specifier, name: operand.name, bare })
            }
            kind => Err(format!("unknown source-name operand `{kind}`")),
        }
    }

    fn declares(&self, name: &str) -> bool {
        matches!(self, Self::Declares(pattern) if pattern.is_match(name))
    }

    fn imports(&self, from: &str, to: Option<&str>, imported: Option<&str>) -> bool {
        let Self::Imports { specifier, name, bare } = self else { return false };
        (from == specifier || to == Some(specifier.as_str())
            || (*bare && from.strip_prefix(specifier.as_str()).is_some_and(|suffix| suffix.starts_with('/'))))
            && name.as_deref().is_none_or(|name| Some(name) == imported)
    }
}

/// All positive and excluded name operands share one pass over the same source generation.
/// `graph_files` includes edge-only files, whose missing names must remain unknown.
pub(crate) fn query(layers: &[Layer<'_>], operands: Vec<NamesOperand>, graph_files: &[&str]) -> Result<NamesAnswer, String> {
    let predicates: Vec<_> = operands.into_iter().map(Predicate::of).collect::<Result<_, _>>()?;
    let folded = fold(layers);
    let mut files: Vec<_> = graph_files.to_vec();
    files.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    files.dedup();
    let mut crossings: Vec<_> = files.iter().filter_map(|&file| Some(Crossing {
        file, at: *folded.get(file)?, owner: NO_OWNER, others: Vec::new(), parse: None,
    })).collect();
    join_all_parses(layers, &mut crossings);
    let mut answer = NamesAnswer { unread: 0, groups: predicates.iter().map(|_| NamesGroup { files: Vec::new() }).collect() };
    answer.unread = files.iter().filter(|file| crate::seed::readable(file) && !folded.contains_key(**file)).count() as u32;
    for crossing in crossings {
        let Some((layer, row)) = crossing.parse.filter(|&(layer, row)| layers[layer].parses.harvested[row] == 1) else {
            answer.unread += u32::from(crate::seed::readable(crossing.file));
            continue;
        };
        let mut evidence: Vec<Vec<NameEvidence>> = predicates.iter().map(|_| Vec::new()).collect();
        declarations(&layers[layer], row, &predicates, &mut evidence);
        imports(layers, &crossing, (layer, row), &predicates, &mut evidence);
        for (group, evidence) in answer.groups.iter_mut().zip(evidence) {
            if !evidence.is_empty() { group.files.push(NamesFile { file: crossing.file.to_owned(), evidence }); }
        }
    }
    Ok(answer)
}

fn declarations(layer: &Layer, row: usize, predicates: &[Predicate], evidence: &mut [Vec<NameEvidence>]) {
    if !predicates.iter().any(|predicate| matches!(predicate, Predicate::Declares(_))) { return }
    let (text, parses) = (&layer.stored, &layer.parses);
    let exports = if parses.exports_present[row] == 1 { parses.exports.range(row) } else { 0..0 };
    let bound: FxHashSet<_> = parses.requests.range(row)
        .flat_map(|request| parses.request_bindings.range(request))
        .map(|binding| text.text(parses.binding_local.at(binding))).collect();
    let named_default = exports.clone().any(|export| text.optional(parses.export_exported.at(export)) == Some("default")
        && text.optional(parses.export_local.at(export)).is_some_and(|name| name != "default"));
    let mut seen = FxHashSet::default();
    let mut add = |name: &str, line| {
        if !seen.insert(name.to_owned()) { return }
        for (predicate, rows) in predicates.iter().zip(&mut *evidence) {
            if predicate.declares(name) {
                rows.push(NameEvidence { line, name: Some(name.to_owned()), from: None, local: None, through: None });
            }
        }
    };
    for symbol in parses.symbols.range(row) {
        let name = text.text(parses.symbol_name.at(symbol));
        if named_default && name == "default" { continue }
        add(name, parses.symbol_line.at(symbol));
    }
    for export in exports {
        let Some(name) = text.optional(parses.export_exported.at(export)) else { continue };
        if text.optional(parses.export_from.at(export)).is_some() { continue }
        if text.optional(parses.export_local.at(export)).is_some_and(|local|
            bound.contains(local) || (named_default && name == "default")) { continue }
        add(name, parses.export_line.at(export));
    }
}

fn imports(layers: &[Layer], crossing: &Crossing, parse: (usize, usize), predicates: &[Predicate], evidence: &mut [Vec<NameEvidence>]) {
    if !predicates.iter().any(|predicate| matches!(predicate, Predicate::Imports { .. })) { return }
    let (layer, row) = parse;
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let (record_layer, record_row) = crossing.at;
    let (record_text, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let requests = parses.requests.range(row);
    let targets = records.targets.range(record_row);
    let mut members: Vec<Vec<usize>> = (0..requests.len()).map(|_| Vec::new()).collect();
    for member in parses.members.range(row) {
        if let Some(list) = members.get_mut(parses.member_request.at(member) as usize) { list.push(member); }
    }
    for (local_index, request) in requests.enumerate() {
        let from = text.text(parses.request_value.at(request));
        let to = (records.targets_present[record_row] == 1 && local_index < targets.len())
            .then(|| record_text.optional(records.target_path.at(targets.start + local_index))).flatten();
        let mut add = |name: Option<&str>, local: Option<&str>, through: Option<&str>, line| {
            for (predicate, rows) in predicates.iter().zip(&mut *evidence) {
                if predicate.imports(from, to, name) {
                    rows.push(NameEvidence { line, name: name.map(str::to_owned), from: Some(from.to_owned()),
                        local: local.map(str::to_owned), through: through.map(str::to_owned) });
                }
            }
        };
        let mut named = false;
        let mut through = None;
        for binding in parses.request_bindings.range(request) {
            let (name, local) = (text.text(parses.binding_imported.at(binding)), text.text(parses.binding_local.at(binding)));
            if name == "*" { if through.is_none() { through = Some(local); } continue }
            named = true;
            add(Some(name), (local != name).then_some(local), None, parses.binding_line.at(binding));
        }
        for &member in &members[local_index] {
            named = true;
            add(Some(text.text(parses.member_name.at(member))), None, through, parses.member_line.at(member));
        }
        if !named { add(None, None, None, parses.request_line.at(request)); }
    }
}

#[cfg(test)]
#[path = "source_names_tests.rs"]
mod tests;
