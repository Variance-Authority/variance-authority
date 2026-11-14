//! The Help value `variance index` publishes, refreshed from the chain it just
//! wrote without its export list or its imports by path ever reaching
//! JavaScript.
//!
//! `publishWorkspaceFromIndex` in `packages/help/src/refresh-native.ts` drives
//! it. A reading holds what the chain says — the uses JavaScript joins against
//! the documented surface, and the export list, the imports by path and the
//! path graph it has nothing to add to — and publishing writes the two files
//! beside the index that `tryPublishWorkspaceSnapshot` in `snapshot.ts` writes
//! for a value read the long way: the graph, and the store (`help_store.rs`).

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;
use std::sync::Arc;

use napi::bindgen_prelude::AsyncTask;
use napi_derive::napi;
use rayon::prelude::*;
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::help_aliases::{aliases, Alias};
use crate::help_declared::{declared, declared_terms, Declared, Matching};
use crate::off_thread::{off_thread, OffThread};
use crate::help_search::{exported_digest, set_digest};
use crate::help_store::{encode, DeepRef, StoreMeta, StorePackage, StoreRef};
use crate::help_members::{indexed_extensions, member_declarations, members_on, ContainerMember, MemberDeclarations};
use crate::help_origin::{declaration_exported, ExportedDeclaration};
use crate::help_usage::{importers, usage, DeepRequest, Importers, IndexedUsage, NamedExport};
use crate::index_chain::read_chain;
use crate::source_tree::tree;

/// What the chain says for a Help value, held on this side.
#[napi]
pub struct HelpReading {
    held: Arc<Held>,
    /// What `usage` hands over once, with its export list and imports by path left empty.
    usage: Option<IndexedUsage>,
}

/// What publishing reads, shared with the thread that writes it.
struct Held {
    exported: Vec<NamedExport>,
    /// The deep imports, those of packages that declare no entry, and those unfollowed.
    deep: [Vec<DeepRequest>; 3],
    tree: Vec<u8>,
    digest: String,
}

/// The value's own fields, joined by JavaScript: they are the documented
/// surface and are small.
#[napi(object)]
pub struct HelpPublish {
    /// Where the store and the graph are written: `snapshot`, and the graph at
    /// `graph` followed by its digest and `.bin`.
    pub snapshot: String,
    pub graph: String,
    pub root: String,
    pub graph_root: String,
    pub generated_at: String,
    /// When the read behind the value began, before any of it was read.
    pub read_started_at: String,
    /// The digest of the index manifest the reading was made from, which a
    /// later refresh over the same manifest keeps the value by.
    pub index_digest: String,
    /// What `digest_forwards` states of the reading's `export … from` rows.
    pub forwards_digest: String,
    /// What `workspacePackagesDigest` states of the manifests the value was joined against.
    pub packages_digest: String,
    pub packages: Vec<StorePackage>,
    pub unreadable: Vec<String>,
}

#[napi(object)]
pub struct HelpPublished {
    pub graph_digest: String,
}

/// The reading of the chain at `index` for the entrypoints in `opened`, the
/// imports into the packages in `published` that no entry opens, the packages
/// in `unentered`, which declare no entry, and the specifiers in `declared`,
/// which a manifest names whether or not the reading could follow them;
/// `None` when there is no index.
#[napi(ts_return_type = "Promise<HelpReading | null>")]
pub fn read_help(root: String, index: String, opened: Vec<String>, published: Vec<String>, unentered: Vec<String>, declared: Vec<String>) -> AsyncTask<OffThread<Option<HelpReading>>> {
    off_thread(move || reading(&root, &index, &opened, &published, &unentered, &declared))
}

fn reading(root: &str, index: &str, opened: &[String], published: &[String], unentered: &[String], declared: &[String]) -> napi::Result<Option<HelpReading>> {
    opened_chain(index, |layers| {
        let (mut read, tree) = rayon::join(|| usage(root, layers, opened, published, unentered, declared), || tree(layers));
        let exported = std::mem::take(&mut read.exported);
        let deep = [std::mem::take(&mut read.deep), std::mem::take(&mut read.by_path), std::mem::take(&mut read.unfollowed)];
        let digest = exported_digest(&exported);
        HelpReading { held: Arc::new(Held { exported, deep, tree, digest }), usage: Some(read) }
    })
}

/// Every import of `name` out of one of `files`, which are repo-relative, by
/// any file of the chain at `index`, relative imports included, and through
/// each file that passes it on with `export … from`, which is named in
/// `through` and is no use; `None` when there is no index. A use's `key` is the
/// specifier as the importing file wrote it, and its `name` the name it takes.
#[napi]
pub fn importers_of(root: String, index: String, files: Vec<String>, name: String) -> napi::Result<Option<Importers>> {
    opened_chain(&index, |layers| importers(&root, layers, &files, &name))
}

/// Every specifier on the chain at `index` that names a package or a runtime
/// module no file answers, out of which an import takes `name`, in code-unit
/// order; `None` when there is no index.
#[napi]
pub fn outside_sources_of(root: String, index: String, name: String) -> napi::Result<Option<Vec<String>>> {
    opened_chain(&index, |layers| crate::help_usage::sources(&root, layers, &name))
}

/// Every import on the chain at `index` that binds `local` to an export of
/// another name, ordered by the importing file in code units, then by line;
/// `None` when there is no index.
#[napi]
pub fn aliases_of(root: String, index: String, local: String) -> napi::Result<Option<Vec<Alias>>> {
    opened_chain(&index, |layers| aliases(&root, layers, &local))
}

/// Every declaration of a member named `name` the chain at `index` records,
/// ordered by file in code units, then by line, beside the extensions of the
/// files the chain holds; `None` when there is no index.
#[napi]
pub fn member_declarations_of(root: String, index: String, name: String) -> napi::Result<Option<MemberDeclarations>> {
    opened_chain(&index, |layers| MemberDeclarations { sites: member_declarations(&root, layers, &name), extensions: indexed_extensions(layers) })
}

/// Every member the interface, type alias or class named `on` declares in
/// `file`, repo-relative, by line; `None` when there is no index.
#[napi]
pub fn members_on_of(index: String, file: String, on: String) -> napi::Result<Option<Vec<ContainerMember>>> {
    opened_chain(&index, |layers| members_on(layers, &file, &on))
}

/// What the index reads of the declaration an export binds.
#[napi(object)]
pub struct ExportedReading {
    /// `None` when the walk ends short of a declaration.
    pub declaration: Option<ExportedDeclaration>,
}

/// The declaration the export `name` of `file`, repo-relative, binds, as
/// [`declaration_exported`] walks to it; `None` when there is no index.
#[napi]
pub fn declaration_exported_of(index: String, file: String, name: String) -> napi::Result<Option<ExportedReading>> {
    opened_chain(&index, |layers| ExportedReading { declaration: declaration_exported(layers, &file, &name) })
}

/// Every top-level declaration on the chain at `index` that no export of its
/// file binds, named `query` or, with `containing`, whose lowercased name or doc
/// comment holds `query`, which the caller lowercased; only in `files` when they
/// are named.
/// `None` when there is no index.
#[napi]
pub fn declared_of(root: String, index: String, query: String, containing: bool, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = if containing { Matching::Containing } else { Matching::Exact };
    opened_chain(&index, |layers| declared(&root, layers, &query, matching, files.as_deref()))
}

/// The declarations no export binds whose name and doc hold any of `stems` —
/// `describedWords`' stems of `query` — in `files` when they are named, each
/// with the positions of the stems it holds and how near its doc writes
/// `query`; and the files whose name and module doc hold any, the same way.
/// `None` when there is no index.
#[napi]
pub fn declared_described_of(root: String, index: String, query: String, stems: Vec<String>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = Matching::Described { stems, query };
    opened_chain(&index, |layers| declared(&root, layers, "", matching, files.as_deref()))
}

/// The distinct search terms of the top-level names the chain at `index`
/// harvested, in `files` when they are named, sorted by their UTF-8 bytes: the
/// dictionary the loose pass reads for names no export list holds.
/// `None` when there is no index.
#[napi]
pub fn declared_terms_of(index: String, files: Option<Vec<String>>) -> napi::Result<Option<Vec<String>>> {
    opened_chain(&index, |layers| declared_terms(layers, files.as_deref()))
}

/// The declarations no export binds whose name's terms hold one of every
/// group of `groups`, in `files` when they are named: the names the loose pass
/// reaches among them. `None` when there is no index.
#[napi]
pub fn declared_loose_of(root: String, index: String, groups: Vec<Vec<String>>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    opened_chain(&index, |layers| declared(&root, layers, "", Matching::Terms { groups }, files.as_deref()))
}

/// The chain at `index`, each segment opened in place, handed to `read`;
/// `None` when there is no index.
fn opened_chain<T>(index: &str, read: impl FnOnce(&[Layer]) -> T) -> napi::Result<Option<T>> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = read_chain(index).map_err(fail)? else { return Ok(None) };
    let layers = chain.segments.par_iter().enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fail)?;
    Ok(Some(read(&layers)))
}

/// The `export … from` rows of a reading as a set, which the export list does
/// not hold: `export *` names nothing, and a named row does not say where it leads.
#[napi(catch_unwind)]
pub fn digest_forwards(forwards: Vec<String>) -> String {
    set_digest(forwards)
}

#[napi]
impl HelpReading {
    /// The export list as a set, as the store's `exportedDigest` states it.
    #[napi(getter)]
    pub fn exported_digest(&self) -> String {
        self.held.digest.clone()
    }

    /// The rows of the export list that `files` write, for the few a caller
    /// compares: the list itself stays here.
    #[napi]
    pub fn exported_of(&self, files: Vec<String>) -> Vec<NamedExport> {
        let files: HashSet<String> = files.into_iter().collect();
        self.held.exported.iter().filter(|named| files.contains(&named.at)).cloned().collect()
    }

    /// The uses and unreadable files, handed over once: the export list and
    /// the imports by path are left empty, and stay here.
    #[napi]
    pub fn usage(&mut self) -> IndexedUsage {
        self.usage.take().unwrap_or_else(|| IndexedUsage {
            exported: Vec::new(), forwards: Vec::new(), deep: Vec::new(), by_path: Vec::new(), unfollowed: Vec::new(), unreadable: Vec::new(), names: Vec::new(),
        })
    }

    /// Write the graph and the store. A graph already written under its
    /// digest is the same bytes, and is not written again.
    #[napi(ts_return_type = "Promise<HelpPublished>")]
    pub fn publish(&self, o: HelpPublish) -> AsyncTask<OffThread<HelpPublished>> {
        let held = Arc::clone(&self.held);
        off_thread(move || held.publish(o))
    }
}

impl Held {
    fn publish(&self, o: HelpPublish) -> napi::Result<HelpPublished> {
        let fail = |error: std::io::Error| napi::Error::from_reason(error.to_string());
        let graph_digest: String = Sha256::digest(&self.tree).iter().map(|byte| format!("{byte:02x}")).collect();
        let meta = StoreMeta {
            root: o.root,
            graph_root: o.graph_root,
            graph_digest: graph_digest.clone(),
            generated_at: o.generated_at,
            read_started_at: o.read_started_at,
            forwards_digest: Some(o.forwards_digest),
            index_digest: Some(o.index_digest),
            packages_digest: Some(o.packages_digest),
        };
        let deep = [&self.deep[0], &self.deep[1], &self.deep[2]].map(|held| held.iter().map(DeepRef::from).collect());
        let input = StoreRef { packages: &o.packages, deep, unreadable: &o.unreadable };
        let (store, _) = encode(&input, &self.exported, Some(&meta), Some(&self.digest));
        if let Some(parent) = std::path::Path::new(&o.snapshot).parent() {
            std::fs::create_dir_all(parent).map_err(fail)?;
        }
        let graph = format!("{}{graph_digest}.bin", o.graph);
        if !std::path::Path::new(&graph).exists() {
            replace(&graph, &self.tree).map_err(fail)?;
        }
        replace(&o.snapshot, &store).map_err(fail)?;
        Ok(HelpPublished { graph_digest })
    }
}

/// Write beside `path` and rename over it, so a reader sees one whole file.
fn replace(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    let written = format!("{path}.{}.tmp", std::process::id());
    std::fs::write(&written, bytes)?;
    std::fs::rename(&written, path)
}
