//! The baseline publication and advancing closure of one source update.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::HashSet;

use rustc_hash::{FxHashMap, FxHashSet};

use super::Row;
use crate::chain_lookup::At;

use crate::compact::Layer;
use crate::index_chain::{read_chain, Chain};
use crate::log::{LogSegment, Over};

/// The files the index reaches from its seeds over the records it holds and
/// the ones just built; the reached files no record answers for are `need`.
///
/// A walk that stops at `need` is resumed from there once they are built,
/// rather than walked again from the seeds: the second walk would visit every
/// file the first one did, and on a large checkout that is most of an update.
pub(super) struct Reached<'l> {
    pub old: FxHashSet<&'l str>,
    pub new: HashSet<String>,
    pub need: Vec<String>,
    needed: FxHashSet<String>,
    pub stack: Vec<Cow<'l, str>>,
}

/// Node's `extname`.
fn extname(path: &str) -> &str {
    let base = path.rsplit('/').next().unwrap_or(path);
    match base.rfind('.') {
        Some(at) if at > 0 => &base[at..],
        _ => "",
    }
}

impl<'l> Reached<'l> {
    pub fn from(seeds: &'l [String], capacity: usize) -> Self {
        let stack = seeds.iter().map(|seed| Cow::Borrowed(seed.as_str())).collect();
        Reached { old: FxHashSet::with_capacity_and_hasher(capacity, Default::default()), new: HashSet::new(), need: Vec::new(), needed: FxHashSet::default(), stack }
    }

    /// Walk until the stack is empty, leaving what no record answers for in `need`.
    pub fn walk(&mut self, layers: &'l [Layer<'l>], valid: &FxHashMap<&'l str, At>, walked: &FxHashMap<String, Row>, readable: &FxHashSet<String>) {
        while let Some(file) = self.stack.pop() {
            if let Some(row) = walked.get(file.as_ref()) {
                if self.new.insert(file.as_ref().to_owned()) {
                    let edges = row.indexed.record.edges.iter().flatten().map(|edge| edge.to.as_str());
                    self.stack.extend(edges.filter(|to| readable.contains(extname(to))).map(|to| Cow::Owned(to.to_owned())));
                }
            } else if let Some((&key, &(layer, at))) = valid.get_key_value(file.as_ref()) {
                if self.old.insert(key) {
                    let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                    if let Some(edges) = records.edges_of(stored, at) {
                        self.stack.extend(edges.map(|(to, _)| to).filter(|to| readable.contains(extname(to))).map(Cow::Borrowed));
                    }
                }
            } else if self.needed.insert(file.as_ref().to_owned()) {
                self.need.push(file.into_owned());
            }
        }
    }
}

pub(super) struct Baseline {
    chain: Option<Chain>,
    unread: Option<Vec<u8>>,
    missing: bool,
}

pub(super) struct View<'b> {
    pub layers: Vec<Layer<'b>>,
    pub count: usize,
    pub was: &'static str,
    pub written: Option<u32>,
    pub repair: bool,
    /// Whether prior records were resolved under this update's configuration.
    pub records_current: bool,
}

impl Baseline {
    pub fn read(path: &str) -> Self {
        match read_chain(path) {
            Ok(chain) => Self { missing: chain.is_none(), chain, unread: None },
            Err(_) => Self { chain: None, unread: std::fs::read(path).ok(), missing: false },
        }
    }

    pub fn segments(&self) -> &[Vec<u8>] {
        self.chain.as_ref().map_or(&[], |chain| chain.segments.as_slice())
    }

    /// Open once, stopping before the first damaged or foreign segment.
    pub fn view(&self, config: &str) -> View<'_> {
        let mut view = View { layers: Vec::new(), count: 0, was: if self.missing { "missing" } else { "damaged" }, written: None, repair: true, records_current: false };
        let Some(chain) = &self.chain else { return view };
        view.was = if chain.damaged() == 0 { "published" } else { "damaged" };
        for bytes in &chain.segments {
            let opened = std::panic::catch_unwind(|| Layer::open(bytes)).ok().and_then(Result::ok);
            let Some(layer) = opened else {
                view.written = other_version(bytes);
                view.was = if view.written.is_some() { "other-version" } else { "damaged" };
                break;
            };
            view.layers.push(layer);
        }
        let legacy = chain.references.is_empty();
        let changed = view.layers.last().and_then(|layer| layer.config) != Some(config);
        view.repair = view.was != "published" || legacy || changed;
        // Configuration changes invalidate edges, while byte-keyed parses remain valid.
        view.count = if legacy { 0 } else { view.layers.len() };
        view.records_current = !legacy && !changed;
        view
    }

    pub fn over(&self) -> Over<'_> {
        match self.chain.as_ref().map(Chain::published).or(self.unread.as_deref()) {
            Some(bytes) => Over::Published(bytes),
            None => Over::Nothing,
        }
    }

    /// The original tail, including damage, is retired only under the original manifest.
    pub fn references(&self) -> Vec<LogSegment> {
        self.chain.as_ref().map_or_else(Vec::new, |chain| chain.references.iter().map(|reference| LogSegment {
            digest: reference.digest.clone(), length: reference.length as i64,
        }).collect())
    }

    pub fn working(&self, count: usize) -> usize {
        self.chain.as_ref().map_or(0, |chain| count.saturating_sub(chain.references.len() - chain.working))
    }
}

/// A foreign source-index header is a version mismatch, not generic damage.
fn other_version(bytes: &[u8]) -> Option<u32> {
    #[derive(serde::Deserialize)]
    struct Header { format: String, version: u32 }
    let length = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let text = std::str::from_utf8(bytes.get(4..4usize.checked_add(length)?)?).ok()?;
    let header: Header = serde_json::from_str(text.trim_end_matches('\0')).ok()?;
    (header.format == crate::segment::FORMAT && header.version != u32::from(crate::segment::VERSION)).then_some(header.version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::{encode_generation, Deleted, Generation};
    use crate::read::Read;

    fn directory(name: &str) -> (std::path::PathBuf, String) {
        let root = std::env::temp_dir().join(format!("va-update-state-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("index.bin").to_str().unwrap().to_owned();
        (root, path)
    }

    fn segment(config: &str) -> Vec<u8> {
        encode_generation::<Read>(&Generation { config: Some(config), directories: &[], parses: &[], records: &[], deleted: Deleted::default() })
    }

    #[test]
    fn a_configuration_change_rebuilds_records_but_keeps_opened_parse_layers() {
        let (root, path) = directory("cold-config");
        let missing = Baseline::read(&path);
        let view = missing.view("one");
        assert_eq!((view.was, view.count, view.repair), ("missing", 0, true));
        crate::log::written(&path, Over::Nothing, &[], &[&segment("one")], &[], 0).unwrap();
        let changed = Baseline::read(&path);
        let view = changed.view("two");
        assert_eq!((view.was, view.count, view.repair), ("published", 1, true));
        assert!(!view.records_current);
        assert_eq!(view.layers.len(), 1);
        assert!(matches!(changed.over(), Over::Published(_)), "rebuilds still compare the original publication");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_damaged_tail_keeps_the_valid_prefix_and_retires_the_original_tail() {
        let (root, path) = directory("prefix");
        crate::log::written(&path, Over::Nothing, &[], &[&segment("one"), &segment("two")], &[], 1).unwrap();
        let initial = Baseline::read(&path);
        let references = initial.references();
        std::fs::remove_file(crate::log::file_name(&format!("{path}.segments"), &references[1].digest)).unwrap();
        let damaged = Baseline::read(&path);
        let view = damaged.view("one");
        assert_eq!((view.was, view.count, view.repair), ("damaged", 1, true));
        assert_eq!((damaged.references().len(), damaged.working(view.count)), (2, 0));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_foreign_legacy_header_reports_its_version_and_is_replaced() {
        let (root, path) = directory("foreign");
        let bytes = crate::segment::encode_as(crate::segment::FORMAT, 15, Vec::new());
        std::fs::write(&path, bytes).unwrap();
        let foreign = Baseline::read(&path);
        let view = foreign.view("one");
        assert_eq!((view.was, view.written, view.count), ("other-version", Some(15), 0));
        assert!(matches!(foreign.over(), Over::Published(_)));
        std::fs::remove_dir_all(root).unwrap();
    }
}
