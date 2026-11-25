//! Active files a declaration lookup may read, joined to their current parses.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use crate::chain_lookup::live_records;
use crate::compact::Layer;
use crate::package_graph::{join_parses, Crossing};
use crate::package_owners::NO_OWNER;

/// Active paths in code-unit order, each joined to its current parse.
pub(crate) fn crossings<'a>(layers: &'a [Layer<'a>], files: Option<&[String]>) -> Vec<Crossing<'a>> {
    let mut crossings = joined_crossings(layers, files);
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    crossings
}

/// Active paths in no particular order, each joined to its current parse: the
/// chain's newest records, read layer by layer with no map of every file.
pub(super) fn joined_crossings<'a>(layers: &'a [Layer<'a>], files: Option<&[String]>) -> Vec<Crossing<'a>> {
    let wanted: Option<HashSet<&str>> = files.map(|files| files.iter().map(String::as_str).collect());
    let mut crossings: Vec<Crossing> = live_records(layers)
        .into_iter()
        .filter(|(file, _)| wanted.as_ref().is_none_or(|wanted| wanted.contains(*file)))
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    crossings
}
