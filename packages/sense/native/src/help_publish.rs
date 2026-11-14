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
use crate::help_usage::{importers, usage, Configurations, DeepRequest, Importers, IndexedUsage, NamedExport};
use crate::index_chain::read_chain;
use crate::source_tree::{tree, Mocking};

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
/// `None` when there is no index. A test's loads beside its mocks join the
/// graph resolved with `tsconfig`, as the scan resolves imports, and are code
/// when they end in one of `code`.
#[napi(ts_return_type = "Promise<HelpReading | null>")]
#[allow(clippy::too_many_arguments)]
pub fn read_help(
    root: String,
    index: String,
    opened: Vec<String>,
    published: Vec<String>,
    unentered: Vec<String>,
    declared: Vec<String>,
    tsconfig: Option<napi::Either<String, bool>>,
    code: Vec<String>,
) -> AsyncTask<OffThread<Option<HelpReading>>> {
    let tsconfig = crate::resolve::Tsconfig::from_js(tsconfig);
    off_thread(move || {
        let mocking = Mocking::at(&root, tsconfig, code);
        reading(&root, index, &opened, &published, &unentered, &declared, &mocking)
    })
}

/// The source tree of the chain at `index`, as [`read_help`] publishes it, for
/// a reading that drew its usage on the JavaScript side; `None` when there is
/// no index.
#[napi(ts_return_type = "Promise<Buffer | null>")]
pub fn source_tree_of(root: String, index: String, tsconfig: Option<napi::Either<String, bool>>, code: Vec<String>) -> AsyncTask<OffThread<Option<napi::bindgen_prelude::Buffer>>> {
    let tsconfig = crate::resolve::Tsconfig::from_js(tsconfig);
    off_thread(move || {
        let mocking = Mocking::at(&root, tsconfig, code);
        opened_chain(&open_index(index)?, |layers| tree(layers, &mocking).into())
    })
}

fn reading(root: &str, index: String, opened: &[String], published: &[String], unentered: &[String], declared: &[String], mocking: &Mocking) -> napi::Result<Option<HelpReading>> {
    opened_chain(&open_index(index)?, |layers| {
        let (mut read, tree) = rayon::join(|| usage(root, layers, opened, published, unentered, declared), || tree(layers, mocking));
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
pub fn importers_of(root: String, index: &OpenedIndex, files: Vec<String>, name: String) -> napi::Result<Option<Importers>> {
    opened_chain(index, |layers| importers(&root, layers, &index.configurations, &files, &name))
}

/// Every specifier on the chain at `index` that names a package or a runtime
/// module no file answers, out of which an import takes `name`, in code-unit
/// order; `None` when there is no index.
#[napi]
pub fn outside_sources_of(root: String, index: &OpenedIndex, name: String) -> napi::Result<Option<Vec<String>>> {
    opened_chain(index, |layers| crate::help_usage::sources(&root, layers, &index.configurations, &name))
}

/// Every import on the chain at `index` that binds `local` to an export of
/// another name, ordered by the importing file in code units, then by line;
/// `None` when there is no index.
#[napi]
pub fn aliases_of(root: String, index: &OpenedIndex, local: String) -> napi::Result<Option<Vec<Alias>>> {
    opened_chain(index, |layers| aliases(&root, layers, &local))
}

/// Every declaration of a member named `name` the chain at `index` records,
/// ordered by file in code units, then by line, beside the extensions of the
/// files the chain holds; `None` when there is no index.
#[napi]
pub fn member_declarations_of(root: String, index: &OpenedIndex, name: String) -> napi::Result<Option<MemberDeclarations>> {
    opened_chain(index, |layers| MemberDeclarations { sites: member_declarations(&root, layers, &name), extensions: indexed_extensions(layers) })
}

/// Every member the interface, type alias or class named `on` declares in
/// `file`, repo-relative, by line; `None` when there is no index.
#[napi]
pub fn members_on_of(index: &OpenedIndex, file: String, on: String) -> napi::Result<Option<Vec<ContainerMember>>> {
    opened_chain(index, |layers| members_on(layers, &file, &on))
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
pub fn declaration_exported_of(index: &OpenedIndex, file: String, name: String) -> napi::Result<Option<ExportedReading>> {
    opened_chain(index, |layers| ExportedReading { declaration: declaration_exported(layers, &file, &name) })
}

/// Every top-level declaration on the chain at `index` that no export of its
/// file binds, named `query` or, with `containing`, whose lowercased name or doc
/// comment holds `query`, which the caller lowercased; only in `files` when they
/// are named.
/// `None` when there is no index.
#[napi]
pub fn declared_of(root: String, index: &OpenedIndex, query: String, containing: bool, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = if containing { Matching::Containing } else { Matching::Exact };
    opened_chain(index, |layers| declared(&root, layers, &query, matching, files.as_deref()))
}

/// The declarations no export binds whose name and doc hold any of `stems` —
/// `describedWords`' stems of `query` — in `files` when they are named, each
/// with the positions of the stems it holds and how near its doc writes
/// `query`; and the files whose name and module doc hold any, the same way.
/// `None` when there is no index.
#[napi]
pub fn declared_described_of(root: String, index: &OpenedIndex, query: String, stems: Vec<String>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = Matching::Described { stems, query };
    opened_chain(index, |layers| declared(&root, layers, "", matching, files.as_deref()))
}

/// The distinct search terms of the top-level names the chain at `index`
/// harvested, in `files` when they are named, sorted by their UTF-8 bytes: the
/// dictionary the loose pass reads for names no export list holds.
/// `None` when there is no index.
#[napi]
pub fn declared_terms_of(index: &OpenedIndex, files: Option<Vec<String>>) -> napi::Result<Option<Vec<String>>> {
    opened_chain(index, |layers| declared_terms(layers, files.as_deref()))
}

/// The declarations no export binds whose name's terms hold one of every
/// group of `groups`, in `files` when they are named: the names the loose pass
/// reaches among them. `None` when there is no index.
#[napi]
pub fn declared_loose_of(root: String, index: &OpenedIndex, groups: Vec<Vec<String>>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    opened_chain(index, |layers| declared(&root, layers, "", Matching::Terms { groups }, files.as_deref()))
}

/// The source index at a path, opened once for one question: every segment the
/// manifest names, checked against its digest and cut at the first that is
/// missing or fails it, as [`read_chain`] reads them, and each opened in place.
/// A question opens it at its start and closes it at its end, and each reading
/// in between is handed the opened layers, so a name declared in ten files no
/// longer reads, hashes and opens the chain ten times. The bytes are copies, so
/// a segment truncated or removed after the open changes nothing the question
/// reads.
#[napi]
pub struct OpenedIndex {
    index: String,
    /// The opened chain; `None` when nothing was ever published.
    opened: Option<Opened>,
    /// The workspace's configurations, read once for the question by the first reading that asks.
    configurations: Configurations,
    closed: bool,
}

/// The layers opened over a chain's segments.
type Layers<'a> = Vec<Layer<'a>>;

self_cell::self_cell!(
    /// Segments and the layers opened over them, kept together because the
    /// layers borrow the bytes.
    struct Opened {
        owner: Vec<Vec<u8>>,
        #[covariant]
        dependent: Layers,
    }
);

impl Opened {
    fn open(segments: Vec<Vec<u8>>) -> Result<Self, String> {
        Opened::try_new(segments, |segments| {
            segments.par_iter().enumerate()
                .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
                .collect()
        })
    }
}

#[napi]
impl OpenedIndex {
    /// Let the bytes go: a question that ended holds nothing until the
    /// collector reaches the handle, and a reading through it is refused.
    #[napi]
    pub fn close(&mut self) {
        self.opened = None;
        self.closed = true;
    }
}

/// The chain at `index`, read and opened for one question.
#[napi]
pub fn open_index(index: String) -> napi::Result<OpenedIndex> {
    let chain = read_chain(&index).map_err(|error| refused(&index, error))?;
    let opened = chain.map(|chain| Opened::open(chain.segments)).transpose().map_err(|error| refused(&index, error))?;
    Ok(OpenedIndex { index, opened, configurations: Configurations::default(), closed: false })
}

fn refused(index: &str, error: String) -> napi::Error {
    napi::Error::from_reason(format!("the source index at {index} did not read: {error}"))
}

/// The layers `opened` holds, handed to `read`; `None` when there is no index.
fn opened_chain<T>(opened: &OpenedIndex, read: impl FnOnce(&[Layer]) -> T) -> napi::Result<Option<T>> {
    if opened.closed {
        return Err(napi::Error::from_reason(format!("the source index at {} was opened for a question that has ended", opened.index)));
    }
    Ok(opened.opened.as_ref().map(|held| read(held.borrow_dependent())))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::Delta;
    use crate::log::{written, Over};

    /// A segment of no files, told apart from another by its configuration.
    fn segment(config: &str) -> Vec<u8> {
        let document = format!(r#"{{"config": "{config}", "records": [], "parses": [], "deletedRecords": [], "deletedParses": []}}"#);
        crate::graph_index::merged(&[], &Delta::of(vec![document]).unwrap())
    }

    /// A chain of segments `a` and `b` at a fresh path, and where `b` is kept.
    fn published(name: &str) -> (std::path::PathBuf, String, String) {
        let directory = std::env::temp_dir().join(format!("va-opened-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("index.bin").to_str().unwrap().to_owned();
        let (a, b) = (segment("v1:a"), segment("v1:b"));
        assert!(written(&path, Over::Nothing, &[], &[&a, &b], &[], 0).unwrap());
        let digest = crate::digest::of_sha256(Sha256::digest(&b).as_slice());
        let second = format!("{path}.segments/{}.bin", digest.replacen(':', "-", 1));
        (directory, path, second)
    }

    /// The configuration of every layer `opened` reads.
    fn configs(opened: &OpenedIndex) -> Option<Vec<String>> {
        opened_chain(opened, |layers| layers.iter().map(|layer| layer.config.unwrap_or("").to_owned()).collect()).unwrap()
    }

    #[test]
    fn a_segment_cut_short_or_missing_at_the_open_ends_the_chain_there() {
        for (name, damage) in [("cut", (|at: &str| std::fs::write(at, b"").unwrap()) as fn(&str)), ("gone", |at| std::fs::remove_file(at).unwrap())] {
            let (directory, path, second) = published(name);
            damage(&second);
            assert_eq!(configs(&open_index(path).unwrap()), Some(vec!["v1:a".to_owned()]), "{name}");
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn a_segment_damaged_after_the_open_is_read_as_it_was() {
        let (directory, path, second) = published("after");
        let opened = open_index(path).unwrap();
        std::fs::write(&second, b"").unwrap();
        assert_eq!(configs(&opened), Some(vec!["v1:a".to_owned(), "v1:b".to_owned()]));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn nothing_published_is_no_chain_and_a_closed_index_is_refused() {
        let directory = std::env::temp_dir().join(format!("va-opened-none-{}", std::process::id()));
        let mut opened = open_index(directory.join("index.bin").to_str().unwrap().to_owned()).unwrap();
        assert!(opened_chain(&opened, |layers| layers.len()).unwrap().is_none());
        opened.close();
        assert!(opened_chain(&opened, |layers| layers.len()).is_err());
    }
}
