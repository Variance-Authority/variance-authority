//! Coverage scopes and sizes are answered beside the retained source columns.
// compass: variance-authority.reach.source-index

use std::collections::{HashSet, VecDeque};
use napi_derive::napi;
use crate::compact::ParseView;
use crate::parse_columns::ParseRow;
use super::SelectionGraph;

#[napi(object)]
pub struct SelectionFileSize { pub file: String, pub bytes: u32, pub lines: u32, pub blocks: Option<u32>, pub exports: Option<u32> }
#[napi(object)]
pub struct SelectionSourceProblem { pub file: String, pub unknown: Option<String> }
#[napi(object)]
pub struct SelectionCoverage { pub from: Option<String>, pub seeds: String, pub unmatched: Option<Vec<String>>, pub files: Vec<String>, pub sizes: Vec<SelectionFileSize> }

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn source_files(&self) -> Vec<String> {
        let mut files: Vec<_> = self.state.sources.iter().cloned().collect();
        files.sort_unstable_by(|a, b| crate::order::code_unit(a, b)); files
    }
    #[napi]
    pub fn source_problems(&self, dirs: Vec<String>) -> Vec<SelectionSourceProblem> {
        let layers = self.state.source.layers();
        self.source_files().into_iter().filter(|file| super::within(file, &dirs)).filter_map(|file| {
            let (_, (layer, row)) = crate::chain_lookup::record(layers, &file)?;
            let record = layers[layer].records.indexed(&layers[layer].stored, row).record;
            (record.unknown.is_some() || record.unresolved.as_ref().is_some_and(|values| values.iter().any(|value| value.starts_with('.'))))
                .then_some(SelectionSourceProblem { file, unknown: record.unknown })
        }).collect()
    }
    #[napi]
    pub fn sizes(&self, files: Vec<String>) -> Vec<SelectionFileSize> {
        let layers = self.state.source.layers();
        files.into_iter().filter_map(|file| {
            let (_, (layer, row)) = crate::chain_lookup::record(layers, &file)?;
            let digest = layers[layer].stored.optional(layers[layer].records.digest.at(row))?;
            let (layer, row) = crate::chain_lookup::parse(layers, digest, &crate::index::way(&file))?;
            let parsed = ParseView::of(&layers[layer], row);
            let size = parsed.size()?;
            Some(SelectionFileSize { file, bytes: size.bytes, lines: size.lines, blocks: size.blocks,
                exports: parsed.exports_present().then(|| parsed.columns.exports.range(row).len() as u32) })
        }).collect()
    }
    #[napi(catch_unwind)]
    pub fn coverage(&self, from: Option<String>, patterns: Option<Vec<String>>) -> napi::Result<SelectionCoverage> {
        let all = self.source_files();
        let Some(written) = from else {
            return Ok(SelectionCoverage { from: None, seeds: "everything".into(), unmatched: None, sizes: self.sizes(all.clone()), files: all })
        };
        let parts: Vec<_> = written.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
        if written.starts_with('/') || parts.contains(&"..") { return Err(napi::Error::from_reason(format!("\"{written}\" is not a directory inside the repository"))) }
        let dir = parts.join("/");
        let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
        let under: Vec<_> = all.into_iter().filter(|file| file.starts_with(&prefix)).collect();
        if under.is_empty() { return Err(napi::Error::from_reason(format!("the source index holds no file under \"{written}\"; spell the directory from the repository root"))) }
        let mut unmatched = patterns.as_ref().map(|_| Vec::new());
        let mut seeds = HashSet::new();
        if let Some(patterns) = &patterns {
            for pattern in patterns {
                let matcher = glob(pattern);
                let hits: Vec<_> = under.iter().filter(|file| matcher.is_match(&file[prefix.len()..])).cloned().collect();
                if hits.is_empty() { unmatched.as_mut().unwrap().push(pattern.clone()); }
                seeds.extend(hits);
            }
        } else { seeds.extend(under); }
        let mut queue: VecDeque<_> = seeds.into_iter().collect();
        let mut reached = HashSet::new();
        while let Some(file) = queue.pop_front() {
            if !self.state.sources.contains(&file) || !reached.insert(file.clone()) { continue }
            let Some(id) = self.state.file(&file) else { continue };
            queue.extend(self.state.depends.row(id).filter(|&(to, _)| self.state.kinds[to as usize] == 0).map(|(to, _)| self.state.names[to as usize].clone()));
        }
        let mut files: Vec<_> = reached.into_iter().collect(); files.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
        Ok(SelectionCoverage { from: (!dir.is_empty()).then_some(dir), seeds: if patterns.is_some() { "entrypoints" } else { "directory" }.into(), unmatched, sizes: self.sizes(files.clone()), files })
    }
}

/// The entry-point pattern language: only stars, question marks and slashes are special.
pub(super) fn glob(pattern: &str) -> regex::Regex {
    let mut source = String::from("^");
    let mut rest = pattern;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix("**/") { source.push_str("(?:[^/]*/)*"); rest = tail; }
        else if rest == "**" { source.push_str(".*"); rest = ""; }
        else {
            let ch = rest.chars().next().unwrap(); rest = &rest[ch.len_utf8()..];
            match ch { '*' => source.push_str("[^/]*"), '?' => source.push_str("[^/]"), _ => source.push_str(&regex::escape(&ch.to_string())) }
        }
    }
    source.push('$'); regex::Regex::new(&source).expect("escaped source patterns compile")
}
