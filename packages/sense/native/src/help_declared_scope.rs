//! Active files a declaration lookup may read, joined to their current parses.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};

use crate::chain_lookup::At;
use crate::compact::Layer;
use crate::package_graph::{join_parses, Crossing};
use crate::package_owners::NO_OWNER;

/// Active paths in code-unit order, each joined to its current parse.
pub(crate) fn crossings<'a>(layers: &[Layer], folded: &HashMap<&'a str, At>, files: Option<&[String]>) -> Vec<Crossing<'a>> {
    let mut crossings = joined_crossings(layers, folded, files);
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    crossings
}

pub(super) fn joined_crossings<'a>(layers: &[Layer], folded: &HashMap<&'a str, At>, files: Option<&[String]>) -> Vec<Crossing<'a>> {
    let wanted: Option<HashSet<&str>> = files.map(|files| files.iter().map(String::as_str).collect());
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|(file, _)| wanted.as_ref().is_none_or(|wanted| wanted.contains(*file)))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    crossings
}
