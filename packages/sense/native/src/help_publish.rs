//! The Help value `variance index` publishes, refreshed from the chain it just
//! wrote without its export list ever reaching JavaScript.
//!
//! `refreshWorkspaceFromIndex` in `packages/help/src/refresh-native.ts` drives
//! it. A reading holds what the chain says — the uses JavaScript joins against
//! the documented surface, and the export list and path graph it has nothing to
//! add to — and publishing writes the three files beside the index that
//! `tryPublishWorkspaceSnapshot` in `snapshot.ts` writes for a value read the
//! long way: the graph, the value, and its search (`help_search.rs`).

// compass: variance-authority.report.agent-surface

use std::io::Write;

use napi_derive::napi;
use rayon::prelude::*;
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::help_search::{encode, exported_digest, PublishedRows, SearchGeneration};
use crate::help_usage::{usage, DeepRequest, IndexedUsage, NameUse, NamedExport};
use crate::index_chain::read_chain;
use crate::source_tree::tree;

/// What the chain says for a Help value, held on this side.
#[napi]
pub struct HelpReading {
    exported: Vec<NamedExport>,
    tree: Vec<u8>,
    digest: String,
    usage: Option<(Vec<NameUse>, Vec<DeepRequest>, Vec<String>)>,
}

/// The value's own fields, printed by JavaScript: they are the documented
/// surface and are small.
#[napi(object)]
pub struct HelpPublish {
    /// Where the value, its search and its graph are written: `snapshot`, and
    /// `search`; the graph at `graph` followed by its digest and `.bin`.
    pub snapshot: String,
    pub search: String,
    pub graph: String,
    pub format: String,
    pub version: u32,
    pub root: String,
    pub graph_root: String,
    pub generated_at: String,
    /// JSON of the value's `packages`, `deep` and `unreadable`.
    pub packages: String,
    pub deep: String,
    pub unreadable: String,
    pub published: PublishedRows,
}

#[napi(object)]
pub struct HelpPublished {
    pub graph_digest: String,
}

/// The reading of the chain at `index` for the entrypoints in `opened`; `None`
/// when there is no index.
#[napi(catch_unwind)]
pub fn read_help(root: String, index: String, opened: Vec<String>) -> napi::Result<Option<HelpReading>> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = read_chain(&index).map_err(fail)? else { return Ok(None) };
    let layers = chain.segments.par_iter().enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fail)?;
    let (read, tree) = rayon::join(|| usage(&root, &layers, &opened), || tree(&layers));
    let IndexedUsage { exported, deep, unreadable, names } = read;
    let digest = exported_digest(&exported);
    Ok(Some(HelpReading { exported, tree, digest, usage: Some((names, deep, unreadable)) }))
}

/// `exportedDigest` of a list JavaScript holds: a value published before the
/// digest was kept beside it.
#[napi(catch_unwind)]
pub fn digest_exported(exported: Vec<NamedExport>) -> String {
    exported_digest(&exported)
}

#[napi]
impl HelpReading {
    /// The export list as a set, as `EncodedSearch.exported` states it.
    #[napi(getter)]
    pub fn exported_digest(&self) -> String {
        self.digest.clone()
    }

    /// The uses, deep requests and unreadable files, handed over once: the
    /// export list is left empty, and stays here.
    #[napi]
    pub fn usage(&mut self) -> IndexedUsage {
        let (names, deep, unreadable) = self.usage.take().unwrap_or_default();
        IndexedUsage { exported: Vec::new(), deep, unreadable, names }
    }

    /// Write the graph, the value and its search. A graph already written
    /// under its digest is the same bytes, and is not written again.
    #[napi(catch_unwind)]
    pub fn publish(&self, o: HelpPublish) -> napi::Result<HelpPublished> {
        let fail = |error: std::io::Error| napi::Error::from_reason(error.to_string());
        let graph_digest: String = Sha256::digest(&self.tree).iter().map(|byte| format!("{byte:02x}")).collect();
        let generation = SearchGeneration {
            root: o.root.clone(),
            graph_root: o.graph_root.clone(),
            graph_digest: graph_digest.clone(),
            generated_at: o.generated_at.clone(),
        };
        let ((search, exported), value) = rayon::join(
            || encode(&o.published, &self.exported, Some(&generation)),
            || value(&o, &generation, &self.digest, &self.exported),
        );
        debug_assert_eq!(exported, self.digest);
        if let Some(parent) = std::path::Path::new(&o.snapshot).parent() {
            std::fs::create_dir_all(parent).map_err(fail)?;
        }
        let graph = format!("{}{graph_digest}.bin", o.graph);
        if !std::path::Path::new(&graph).exists() {
            replace(&graph, &self.tree).map_err(fail)?;
        }
        replace(&o.snapshot, &value.map_err(fail)?).map_err(fail)?;
        replace(&o.search, &search).map_err(fail)?;
        Ok(HelpPublished { graph_digest })
    }
}

/// The value as `JSON.stringify` prints a `WorkspaceSnapshot`, with the
/// export list printed here.
fn value(o: &HelpPublish, generation: &SearchGeneration, digest: &str, exported: &[NamedExport]) -> std::io::Result<Vec<u8>> {
    let json = |text: &str| serde_json::to_string(text).expect("a string prints");
    let mut out = Vec::with_capacity(exported.len() * 200);
    write!(
        out,
        "{{\"format\":{},\"version\":{},\"root\":{},\"graphRoot\":{},\"graphDigest\":{},\"generatedAt\":{},\"exportedDigest\":{},\"help\":{{\"packages\":{},\"deep\":{},\"exported\":",
        json(&o.format), o.version, json(&o.root), json(&o.graph_root), json(&generation.graph_digest), json(&o.generated_at), json(digest),
        o.packages, o.deep,
    )?;
    serde_json::to_writer(&mut out, exported)?;
    write!(out, ",\"unreadable\":{}}}}}\n", o.unreadable)?;
    Ok(out)
}

/// Write beside `path` and rename over it, so a reader sees one whole file.
fn replace(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    let written = format!("{path}.{}.tmp", std::process::id());
    std::fs::write(&written, bytes)?;
    std::fs::rename(&written, path)
}
