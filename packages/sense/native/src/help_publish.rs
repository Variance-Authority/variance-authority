//! The Help value every publish writes, read from the chain the index just
//! saved without its export list, its imports by path or a parse row ever
//! reaching JavaScript.
//!
//! `publishHelp` in `packages/help/src/refresh-native.ts` drives it. A reading
//! holds what the chain says — the uses and the names each published entry
//! hands out, which it joins with manifest metadata into the documented surface, and the
//! export list, the imports by path and the path graph it has nothing to add
//! to — and encoding turns it into the two files written beside the index: the
//! graph, and the store (`help_store.rs`).

// compass: variance-authority.report.agent-surface

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi_derive::napi;
use rayon::prelude::*;
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::git_tree::GitTree;
use crate::help_aliases::{aliases, Alias};
use crate::help_declared::{declared, declared_terms, Declared, Matching};
use crate::off_thread::{off_thread, OffThread};
use crate::help_store::{encode, DeepRef, StoreMeta, StoreRef};

#[path = "source_components.rs"]
mod source_components;

#[path = "help_assembly.rs"]
mod assembly;
use assembly::HelpPackage;
use crate::help_members::{indexed_extensions, member_declarations, members_on, ContainerMember, MemberDeclarations};
use crate::help_names::{published_names, HelpEntry, PublishedName};
use crate::help_origin::{declaration_exported, export_line, ExportedDeclaration};
use crate::help_usage::{importers, usage, Asked, DeepRequest, Importers, IndexedUsage, NamedExport};
use crate::index_chain::read_chain;
use crate::source_tree::{tree, Mocking};
use crate::timings::Phases;

/// What the chain says for a Help value, held on this side, each part handed
/// over once.
#[napi]
pub struct HelpReading {
    /// What encoding reads; `None` once it was encoded.
    held: Option<Held>,
}

/// What encoding reads, moved to the thread that encodes it.
struct Held {
    exported: Vec<NamedExport>,
    usage: IndexedUsage,
    names: Result<Vec<Vec<PublishedName>>, String>,
    /// The deep imports, those of packages that declare no entry, and those unfollowed.
    deep: [Vec<DeepRequest>; 3],
    /// `None` when the caller draws the tree it publishes.
    tree: Option<Vec<u8>>,
}

/// Manifest metadata and publication identity; source facts stay with the reading.
#[napi(object)]
pub struct HelpEncode {
    pub root: String,
    pub graph_root: String,
    pub generated_at: String,
    /// When the read behind the value began, before any of it was read.
    pub read_started_at: String,
    /// The digest of the index manifest the reading was made from, which a
    /// later refresh over the same manifest keeps the value by; absent when
    /// the value holds what no manifest says, such as a caller's taints.
    pub index_digest: Option<String>,
    /// What `workspacePackagesDigest` states of the manifests the value was joined against.
    pub packages_digest: String,
    pub packages: Vec<HelpPackage>,
    pub unreadable: Vec<String>,
    /// The digest of the tree the caller publishes, when the reading drew none.
    pub graph_digest: Option<String>,
}

/// The store's bytes, and the tree's when the reading drew it, under its digest.
#[napi(object)]
pub struct HelpEncoded {
    pub store: Buffer,
    pub tree: Option<Buffer>,
    pub graph_digest: String,
}

/// The reading of the chain at `index` for the openings in `entries`, by their
/// `<package> .<subpath>` key and the repo-relative file each is read from, the
/// imports into the packages in `published` that no entry opens, the packages
/// in `unentered`, which declare no entry, and the specifiers in `declared`,
/// which a manifest names whether or not the reading could follow them;
/// `None` when there is no index. With `drawn`, the reading draws the source
/// tree too: a test's loads beside its mocks join the graph resolved with
/// `tsconfig`, as the scan resolves imports, and are code when they end in one
/// of `code`.
#[napi(ts_return_type = "Promise<HelpReading | null>")]
#[allow(clippy::too_many_arguments)]
pub fn read_help(
    root: String,
    index: String,
    entries: Vec<HelpEntry>,
    published: Vec<String>,
    unentered: Vec<String>,
    declared: Vec<String>,
    drawn: bool,
    tsconfig: Option<napi::Either<String, bool>>,
    code: Vec<String>,
) -> AsyncTask<OffThread<Option<HelpReading>>> {
    read_help_from(root, index, entries, published, unentered, declared, drawn, tsconfig, code, None)
}

#[napi]
impl GitTree {
    /// Read the questions with this scan's manifest namespace and content policy.
    #[napi(ts_return_type = "Promise<HelpReading | null>")]
    #[allow(clippy::too_many_arguments)]
    pub fn read_help(&self, root: String, index: String, entries: Vec<HelpEntry>, published: Vec<String>,
        unentered: Vec<String>, declared: Vec<String>, drawn: bool, tsconfig: Option<napi::Either<String, bool>>,
        code: Vec<String>, packs: Option<bool>,
    ) -> AsyncTask<OffThread<Option<HelpReading>>> {
        let manifests = self.paths.iter().filter(|path| path.rsplit('/').next() == Some("package.json")).cloned().collect();
        let content = (packs != Some(false)).then(|| self.listing());
        read_help_from(root, index, entries, published, unentered, declared, drawn, tsconfig, code, Some((manifests, content)))
    }
}

#[allow(clippy::too_many_arguments)]
fn read_help_from(root: String, index: String, entries: Vec<HelpEntry>, published: Vec<String>,
    unentered: Vec<String>, declared: Vec<String>, drawn: bool, tsconfig: Option<napi::Either<String, bool>>,
    code: Vec<String>, carried: Option<(Vec<String>, Option<std::sync::Arc<crate::emitted::Listing>>)>,
) -> AsyncTask<OffThread<Option<HelpReading>>> {
    let tsconfig = crate::resolve::Tsconfig::from_js(tsconfig);
    off_thread("question read job", move || {
        let mut phases = Phases::new("question inputs", "mock resolver setup");
        let mocking = drawn.then(|| Mocking::at(&root, tsconfig, code));
        phases.next("entry keys");
        let mut opened: Vec<String> = Vec::new();
        for entry in &entries {
            if !opened.contains(&entry.key) {
                opened.push(entry.key.clone());
            }
        }
        phases.note(format_args!("{} entries, {} opened keys, {} published packages, tree requested={drawn}", entries.len(), opened.len(), published.len()));
        phases.next("read and open chain");
        let index = open_index(index)?;
        phases.next("parallel usage, tree and names");
        let answer = opened_chain(&index, |layers| {
            let usage_job = Phases::new("question usage job", "rayon branch wait");
            let tree_job = Phases::new("question tree job", "rayon branch wait");
            let names_job = Phases::new("question names job", "rayon branch wait");
            let (mut read, (tree, names)) = rayon::join(
                || { let mut job = usage_job; job.next("execution"); usage(&root, layers, &opened, &published, &unentered, &declared, carried.as_ref().map(|(manifests, content)| (manifests.as_slice(), content.as_deref()))) },
                || rayon::join(
                    || { let mut job = tree_job; job.next("execution"); mocking.as_ref().map(|mocking| tree(layers, mocking)) },
                    || { let mut job = names_job; job.next("execution"); published_names(layers, &entries) },
                ),
            );
            let exported = std::mem::take(&mut read.exported);
            let deep = [std::mem::take(&mut read.deep), std::mem::take(&mut read.by_path), std::mem::take(&mut read.unfollowed)];
            HelpReading { held: Some(Held { exported, deep, tree, usage: read, names }) }
        });
        phases.next("opened index cleanup");
        drop(index);
        answer
    })
}

/// Every import of each asked name out of the file asked with it, which is
/// repo-relative, by any file of the chain at `index`, relative imports
/// included, and through each file that passes it on with `export … from`,
/// which is named in `through` and is no use; `None` when there is no index. A
/// use's `key` is the specifier as the importing file wrote it, and its `name`
/// the name it takes. Each group is one question, answered in `groups` as it
/// would be alone.
#[napi(catch_unwind)]
pub fn importers_of(root: String, index: &OpenedIndex, asked: Vec<Vec<Asked>>) -> napi::Result<Option<Importers>> {
    opened_chain(index, |layers| importers(&root, layers, &asked))
}

/// Every import on the chain at `index` that binds `local` to an export of
/// another name, ordered by the importing file in code units, then by line;
/// `None` when there is no index.
#[napi(catch_unwind)]
pub fn aliases_of(root: String, index: &OpenedIndex, local: String) -> napi::Result<Option<Vec<Alias>>> {
    opened_chain(index, |layers| aliases(&root, layers, &local))
}

/// Every declaration of a member named `name` the chain at `index` records,
/// ordered by file in code units, then by line, beside the extensions of the
/// files the chain holds; `None` when there is no index.
#[napi(catch_unwind)]
pub fn member_declarations_of(root: String, index: &OpenedIndex, name: String) -> napi::Result<Option<MemberDeclarations>> {
    opened_chain(index, |layers| MemberDeclarations { sites: member_declarations(&root, layers, &name), extensions: indexed_extensions(layers) })
}

/// Every member the interface, type alias or class named `on` declares in
/// `file`, repo-relative, by line; `None` when there is no index.
#[napi(catch_unwind)]
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
#[napi(catch_unwind)]
pub fn declaration_exported_of(index: &OpenedIndex, file: String, name: String) -> napi::Result<Option<ExportedReading>> {
    opened_chain(index, |layers| ExportedReading { declaration: declaration_exported(layers, &file, &name) })
}

/// The text of the line an export of `file`, repo-relative, is written on,
/// as [`export_line`] keeps it; `None` when there is none or no index.
#[napi]
pub fn export_line_of(index: &OpenedIndex, file: String, line: u32) -> napi::Result<Option<String>> {
    Ok(opened_chain(index, |layers| export_line(layers, &file, line))?.flatten())
}

/// Every top-level declaration on the chain at `index` that no export of its
/// file binds, named `query` or, with `containing`, whose lowercased name or doc
/// comment holds `query`, which the caller lowercased; only in `files` when they
/// are named.
/// `None` when there is no index.
#[napi(catch_unwind)]
pub fn declared_of(root: String, index: &OpenedIndex, query: String, containing: bool, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = if containing { Matching::Containing } else { Matching::Exact };
    opened_chain(index, |layers| declared(&root, layers, &query, matching, files.as_deref()))
}

/// The declarations no export binds whose name and doc hold any of `stems` —
/// `describedWords`' stems of `query` — in `files` when they are named, each
/// with the positions of the stems it holds and how near its doc writes
/// `query`; and the files whose name and module doc hold any, the same way.
/// `None` when there is no index.
#[napi(catch_unwind)]
pub fn declared_described_of(root: String, index: &OpenedIndex, query: String, stems: Vec<String>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    let matching = Matching::Described { stems, query };
    opened_chain(index, |layers| declared(&root, layers, "", matching, files.as_deref()))
}

/// The distinct search terms of the top-level names the chain at `index`
/// harvested, in `files` when they are named, sorted by their UTF-8 bytes: the
/// dictionary the loose pass reads for names no export list holds.
/// `None` when there is no index.
#[napi(catch_unwind)]
pub fn declared_terms_of(index: &OpenedIndex, files: Option<Vec<String>>) -> napi::Result<Option<Vec<String>>> {
    opened_chain(index, |layers| declared_terms(layers, files.as_deref()))
}

/// The declarations no export binds whose name's terms hold one of every
/// group of `groups`, in `files` when they are named: the names the loose pass
/// reaches among them. `None` when there is no index.
#[napi(catch_unwind)]
pub fn declared_loose_of(root: String, index: &OpenedIndex, groups: Vec<Vec<String>>, files: Option<Vec<String>>) -> napi::Result<Option<Declared>> {
    opened_chain(index, |layers| declared(&root, layers, "", Matching::Terms { groups }, files.as_deref()))
}

/// The source index at a path, opened once for one question: every segment the
/// manifest names, cut at the first that is missing or of another length, as
/// [`read_chain`] reads them, and each opened in place. A damaged segment of the
/// right length is refused with an error by every reading here, never a crash.
/// A question opens it at its start and closes it at its end, and each reading
/// in between is handed the opened layers, so a name declared in ten files no
/// longer reads and opens the chain ten times. The bytes are copies, so
/// a segment truncated or removed after the open changes nothing the question
/// reads.
#[napi]
pub struct OpenedIndex {
    index: String,
    /// The opened chain; `None` when nothing was ever published.
    opened: Option<std::sync::Arc<Opened>>,
    closed: bool,
    state: String,
    written: Option<u32>,
    error: Option<String>,
}

/// The layers opened over a chain's segments.
type Layers<'a> = Vec<Layer<'a>>;

self_cell::self_cell!(
    /// Segments and the layers opened over them, kept together because the
    /// layers borrow the bytes.
    pub(crate) struct Opened {
        owner: Vec<Vec<u8>>,
        #[covariant]
        dependent: Layers,
    }
);

impl Opened {
    pub(crate) fn layers(&self) -> &[Layer<'_>] { self.borrow_dependent() }
    fn open(segments: Vec<Vec<u8>>, damaged: bool) -> (Self, String, Option<u32>, Option<String>) {
        let mut status = (String::new(), None, None);
        let opened = Opened::new(segments, |segments| {
            let read = crate::index_layers::open(segments, damaged);
            status = (read.state.to_owned(), read.written, read.error);
            read.layers
        });
        (opened, status.0, status.1, status.2)
    }
}

impl OpenedIndex {
    fn readable(&self) -> napi::Result<()> {
        if self.closed { return Err(napi::Error::from_reason("the source index question has ended")); }
        if let Some(error) = &self.error { return Err(refused(&self.index, error.clone())); }
        Ok(())
    }

    pub(crate) fn snapshot(&self) -> napi::Result<Option<std::sync::Arc<Opened>>> {
        self.readable()?;
        Ok(self.opened.as_ref().map(std::sync::Arc::clone))
    }
}

#[napi(object)]
pub struct RecordTextName { pub file: String, pub digest: String }

#[napi(object)]
pub struct SourceIndexStatus {
    pub state: String,
    pub written: Option<u32>,
}

#[napi]
impl OpenedIndex {
    #[napi]
    pub fn status(&self) -> napi::Result<SourceIndexStatus> {
        if self.closed { return Err(napi::Error::from_reason("the source index question has ended")); }
        Ok(SourceIndexStatus { state: self.state.clone(), written: self.written })
    }

    /// Sparse identities from the valid prefix; status reports whether that prefix is complete.
    #[napi]
    pub fn record_names(&self, files: Vec<String>) -> napi::Result<Vec<RecordTextName>> {
        if self.closed { return Err(napi::Error::from_reason("the source index question has ended")); }
        let Some(source) = self.opened.as_ref() else { return Ok(Vec::new()) };
        let layers = source.layers();
        let mut seen = std::collections::HashSet::new();
        Ok(files.into_iter().filter_map(|file| {
            if !seen.insert(file.clone()) { return None; }
            let (_, (layer, row)) = crate::chain_lookup::record(layers, &file)?;
            let digest = layers[layer].stored.optional(layers[layer].records.digest.at(row))?.to_owned();
            Some(RecordTextName { file, digest })
        }).collect())
    }

    /// Only the asked files' recorded mock declarations; source text stays unopened.
    #[napi(catch_unwind)]
    pub fn has_mocks(&self, files: Vec<String>) -> napi::Result<Vec<bool>> {
        self.readable()?;
        let Some(source) = self.opened.as_ref() else { return Ok(vec![false; files.len()]) };
        let layers = source.layers();
        Ok(files.iter().map(|file| {
            let held = || {
                let (_, (layer, row)) = crate::chain_lookup::record(layers, file)?;
                let digest = layers[layer].stored.optional(layers[layer].records.digest.at(row))?;
                let (layer, row) = crate::chain_lookup::parse(layers, digest, &crate::index::way(file))?;
                let parses = &layers[layer].parses;
                Some(!parses.mocks_minus.range(row).is_empty() || !parses.mocks_plus.range(row).is_empty())
            };
            held().unwrap_or(false)
        }).collect())
    }

    #[napi(catch_unwind)]
    pub fn source_tree(&self, root: String, tsconfig: Option<napi::Either<String, bool>>, code: Vec<String>, names: bool) -> napi::Result<Option<crate::source_tree_read::SourceTreeReader>> {
        self.readable()?;
        let Some(source) = self.opened.as_ref() else { return Ok(None) };
        let mocking = Mocking::at(&root, crate::resolve::Tsconfig::from_js(tsconfig), code);
        let bytes = tree(source.layers(), &mocking);
        crate::source_tree_read::SourceTreeReader::open(bytes)
            .map(|reader| Some(reader.with_source(names.then(|| std::sync::Arc::clone(source)))))
            .map_err(napi::Error::from_reason)
    }

    /// Let the bytes go: a question that ended holds nothing until the
    /// collector reaches the handle, and a reading through it is refused.
    #[napi]
    pub fn close(&mut self) {
        self.opened = None;
        self.closed = true;
    }
}

/// The chain at `index`, read and opened for one question.
#[napi(catch_unwind)]
pub fn open_index(index: String) -> napi::Result<OpenedIndex> {
    let (opened, state, written, error) = match read_chain(&index) {
        Ok(Some(chain)) => {
            let damaged = chain.damaged() != 0;
            let (opened, state, written, error) = Opened::open(chain.segments, damaged);
            (Some(std::sync::Arc::new(opened)), state, written, error)
        }
        Ok(None) => (None, "missing".to_owned(), None, None),
        Err(error) => (None, "damaged".to_owned(), None, Some(error)),
    };
    Ok(OpenedIndex { index, opened, closed: false, state, written, error })
}

fn refused(index: &str, error: String) -> napi::Error {
    napi::Error::from_reason(format!("the source index at {index} did not read: {error}"))
}

/// The layers `opened` holds, handed to `read`; `None` when there is no index.
fn opened_chain<T>(opened: &OpenedIndex, read: impl FnOnce(&[Layer]) -> T) -> napi::Result<Option<T>> {
    opened.readable()?;
    Ok(opened.opened.as_ref().map(|held| read(held.borrow_dependent())))
}

#[napi]
impl HelpReading {
    /// The store's bytes and the tree's, once: the export list and the
    /// imports by path go into the store from here.
    #[napi(ts_return_type = "Promise<HelpEncoded>")]
    pub fn encode(&mut self, o: HelpEncode) -> napi::Result<AsyncTask<OffThread<HelpEncoded>>> {
        let held = self.held.take().ok_or_else(|| napi::Error::from_reason("this reading was encoded already"))?;
        Ok(off_thread("question encode job", move || held.encode(o)))
    }
}

impl Held {
    fn encode(self, o: HelpEncode) -> napi::Result<HelpEncoded> {
        let mut phases = Phases::new("question publication", "tree hash");
        phases.note(format_args!("{} packages, {} exports, {} imports by path", o.packages.len(), self.exported.len(), self.deep.iter().map(Vec::len).sum::<usize>()));
        let graph_digest = match (&self.tree, o.graph_digest) {
            (Some(tree), _) => Sha256::digest(tree).iter().map(|byte| format!("{byte:02x}")).collect(),
            (None, Some(digest)) => digest,
            (None, None) => return Err(napi::Error::from_reason("a reading that drew no tree is encoded under the digest of the caller's")),
        };
        phases.next("store inputs");
        let packages = assembly::assemble(&o.graph_root, o.packages, self.names.map_err(napi::Error::from_reason)?, &self.usage).map_err(napi::Error::from_reason)?;
        let mut unreadable = o.unreadable;
        unreadable.extend(self.usage.unreadable);
        let meta = StoreMeta {
            root: o.root,
            graph_root: o.graph_root,
            graph_digest: graph_digest.clone(),
            generated_at: o.generated_at,
            read_started_at: o.read_started_at,
            index_digest: o.index_digest,
            packages_digest: Some(o.packages_digest),
        };
        let deep = [&self.deep[0], &self.deep[1], &self.deep[2]].map(|held| held.iter().map(DeepRef::from).collect());
        let input = StoreRef { packages: &packages, deep, unreadable: &unreadable };
        phases.next("store encoding");
        let (store, _) = encode(&input, &self.exported, Some(&meta), None);
        phases.next("reading cleanup");
        let encoded = HelpEncoded { store: store.into(), tree: self.tree.map(Buffer::from), graph_digest };
        drop(input);
        drop(meta);
        drop(packages);
        drop(unreadable);
        drop(self.deep);
        drop(self.exported);
        Ok(encoded)
    }
}

#[cfg(test)]
#[path = "help_publish_tests.rs"]
mod tests;
