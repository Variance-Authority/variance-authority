//! The questions' store: one binary file beside the index holding the Help
//! value and the search over it.
//!
//! `openHelpStore` in `packages/help/src/search-index.ts` reads it. It is a
//! segment in the source index's framing (`segment::encode_as`), under its own
//! format name. The head comes first: the generation it belongs to, as its own
//! small dictionary (`head.blob`, `head.off`) and one id per field (`head`), so
//! a reader asking whether a store is current reads the header and those three
//! columns and nothing after them. Every other string lives once in one pool.
//!
//! A question reads the columns it prints. The export list, 249,214 rows on
//! Kibana, is never printed as text: it was 162 MB of JSON parsed in front of
//! every name question.

// compass: variance-authority.report.agent-surface

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::help_search::{exported_digest, joined};
use crate::help_usage::{DeepRequest, NameUse, NamedExport};
use crate::segment::{self, Column};
use crate::stored::Stored;

/// `FORMAT` and `VERSION` in `packages/help/src/store-layout.ts`.
pub(crate) const FORMAT: &str = "variance-authority-help-store";
pub(crate) const VERSION: u8 = 8;
pub(crate) const NONE: u32 = u32::MAX;
pub(crate) const USE_KINDS: [&str; 3] = ["source", "test", "story"];
/// The generation's fields, in the order `head` holds them.
const META: usize = 9;
const GENERATED_AT: usize = 3;

/// One place a name is used: `Use`, and `Taken`'s `name` for an import by path.
#[napi(object)]
pub struct StoreUse {
    pub by: String,
    pub at: String,
    pub line: u32,
    pub r#type: bool,
    pub kind: String,
    pub local: Option<String>,
    /// `dynamic` or `namespace`; absent for a named import.
    pub through: Option<String>,
    pub through_line: u32,
    pub through_default: bool,
    pub whole: bool,
    pub name: Option<String>,
}

#[napi(object)]
pub struct StoreMention {
    pub at: String,
    pub line: u32,
    pub text: String,
}

/// `Entry`.
#[napi(object)]
pub struct StoreEntry {
    pub name: String,
    pub kind: String,
    pub at: String,
    pub declared: String,
    pub line: u32,
    pub signature: Option<String>,
    pub doc: Option<String>,
    pub used_by: Vec<String>,
    pub uses: u32,
    pub sites: Vec<StoreUse>,
    pub through_default: Vec<StoreUse>,
    pub mention: Option<StoreMention>,
}

/// `Opening`, with the specifier a search line prints for it.
#[napi(object)]
pub struct StoreOpening {
    pub subpath: String,
    pub source: String,
    pub spec: String,
    pub entries: Vec<StoreEntry>,
    pub whole: Vec<StoreUse>,
}

/// `Documented`.
#[napi(object)]
pub struct StorePackage {
    pub name: String,
    pub entry: bool,
    pub openings: Vec<StoreOpening>,
}

/// `Deep`.
#[napi(object)]
pub struct StoreDeep {
    pub specifier: String,
    pub by: String,
    pub at: String,
    pub line: u32,
    pub to: Option<String>,
    pub names: Vec<StoreUse>,
}

/// A Help value but its export list, which is handed beside it.
#[napi(object)]
pub struct HelpStore {
    pub packages: Vec<StorePackage>,
    pub deep: Vec<StoreDeep>,
    pub by_path: Vec<StoreDeep>,
    pub unfollowed: Vec<StoreDeep>,
    pub unreadable: Vec<String>,
}

/// Which generation the store belongs to.
#[napi(object)]
pub struct StoreMeta {
    pub root: String,
    pub graph_root: String,
    pub graph_digest: String,
    pub generated_at: String,
    /// When the read behind the value began, before any of it was read.
    pub read_started_at: String,
    pub index_digest: Option<String>,
    pub packages_digest: Option<String>,
}

#[napi(object)]
pub struct EncodedStore {
    pub bytes: Buffer,
    /// sha256 over the export list as a set of file, name, kind and type, which
    /// the store's head states.
    pub exported: String,
}

/// Encode `store` and `exported`, stamped with `meta` when it is published.
#[napi(catch_unwind)]
pub fn encode_help_store(store: HelpStore, exported: Vec<NamedExport>, meta: Option<StoreMeta>) -> EncodedStore {
    let deep = [&store.deep, &store.by_path, &store.unfollowed].map(|held| held.iter().map(DeepRef::from).collect());
    let packages: Vec<PackageRef> = store.packages.iter().map(PackageRef::from).collect();
    let input = StoreRef { packages: &packages, deep, unreadable: &store.unreadable };
    let (bytes, digest) = encode(&input, &exported, meta.as_ref(), None);
    EncodedStore { bytes: bytes.into(), exported: digest }
}

/// The same store with a new `generatedAt`: every column but the head's is copied as it is.
#[napi(catch_unwind)]
pub fn restamp_help_store(bytes: Buffer, generated_at: String) -> napi::Result<Buffer> {
    restamped(&bytes, &generated_at).map(Into::into).map_err(napi::Error::from_reason)
}

fn restamped(bytes: &[u8], generated_at: &str) -> Result<Vec<u8>, String> {
    let stored = Stored::open_as(bytes, FORMAT, VERSION)?;
    let mut meta = read_head(&stored)?;
    meta[GENERATED_AT] = Some(generated_at);
    let mut columns = Vec::from(head_columns(&meta));
    columns.extend(stored.columns().into_iter().filter(|(name, _, _)| !is_head(name)).map(|(name, width, bytes)| segment::column(name.to_owned(), width, bytes.to_vec())));
    Ok(segment::encode_as(FORMAT, VERSION, columns))
}

fn read_head<'a>(stored: &Stored<'a>) -> Result<Vec<Option<&'a str>>, String> {
    let (blob, off, ids) = (stored.u8s("head.blob")?, stored.u32s("head.off")?, stored.u32s("head")?);
    if ids.len() != META {
        return Err(format!("a help store head of {} fields, not {META}", ids.len()));
    }
    let mut meta: Vec<Option<&str>> = Vec::with_capacity(META);
    for field in 0..META {
        let id = ids.at(field) as usize;
        if ids.at(field) == NONE {
            meta.push(None);
            continue;
        }
        let text = (id + 1 < off.len()).then(|| blob.get(off.at(id) as usize..off.at(id + 1) as usize)).flatten();
        meta.push(Some(text.and_then(|text| std::str::from_utf8(text).ok()).ok_or("a help store head field that is not a string")?));
    }
    Ok(meta)
}

#[cfg(feature = "symbol-spike")]
pub(crate) fn symbol_spike_generation<'a>(bytes: &'a [u8], root: &std::path::Path) -> Result<(&'a str, &'a str), String> {
    let stored = Stored::open_as(bytes, FORMAT, VERSION)?;
    let meta = read_head(&stored)?;
    let [Some(workspace), Some(graph), _, Some(generated), _, _, _, Some(digest), _] = meta.as_slice() else {
        return Err("the help store has no complete source-index generation".into());
    };
    let canonical = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    let at_root = |path| std::fs::canonicalize(path).is_ok_and(|held| held == canonical);
    if !at_root(workspace) || !at_root(graph) {
        return Err("the help store belongs to another checkout".into());
    }
    Ok((generated, digest))
}

fn is_head(name: &str) -> bool {
    name == "head" || name.starts_with("head.")
}

/// The generation as its own dictionary and one id per field, `NONE` for absent.
fn head_columns(meta: &[Option<&str>]) -> [Column; 3] {
    let present: Vec<&str> = meta.iter().flatten().copied().collect();
    let (off, blob) = joined(&present, "");
    let mut next = 0u32;
    let ids = meta.iter().map(|field| field.map_or(NONE, |_| {
        next += 1;
        next - 1
    })).collect();
    [segment::u8s("head.blob", blob), segment::u32s("head.off", off), segment::u32s("head", ids)]
}

/// A use, borrowed from whichever side holds it.
pub(crate) struct UseRef<'a> {
    pub(crate) by: &'a str,
    pub(crate) at: &'a str,
    pub(crate) line: u32,
    r#type: bool,
    pub(crate) kind: &'a str,
    pub(crate) local: Option<&'a str>,
    pub(crate) through: Option<&'a str>,
    pub(crate) through_line: u32,
    pub(crate) through_default: bool,
    pub(crate) whole: bool,
    pub(crate) name: Option<&'a str>,
}

impl<'a> From<&'a StoreUse> for UseRef<'a> {
    fn from(held: &'a StoreUse) -> Self {
        UseRef {
            by: &held.by, at: &held.at, line: held.line, r#type: held.r#type, kind: &held.kind, local: held.local.as_deref(),
            through: held.through.as_deref(), through_line: held.through_line, through_default: held.through_default, whole: held.whole,
            name: held.name.as_deref(),
        }
    }
}

impl<'a> From<&'a NameUse> for UseRef<'a> {
    fn from(held: &'a NameUse) -> Self {
        UseRef {
            by: &held.by, at: &held.at, line: held.line, r#type: held.r#type, kind: &held.kind, local: held.local.as_deref(),
            through: held.through.as_deref(), through_line: held.through_line, through_default: held.through_default, whole: held.whole,
            name: Some(&held.name),
        }
    }
}

impl<'a> UseRef<'a> {
    /// A use of one name, as an entry holds it: its name is the entry's, and
    /// what it is read through is said only when it is read through something.
    pub(crate) fn site(held: &'a NameUse) -> Self {
        let through = held.through.is_some();
        UseRef {
            name: None,
            through_line: if through { held.through_line } else { 0 },
            through_default: through && held.through_default,
            whole: through && held.whole,
            ..UseRef::from(held)
        }
    }
}

/// `Mention`, borrowed.
pub(crate) struct MentionRef<'a> {
    pub(crate) at: &'a str,
    pub(crate) line: u32,
    pub(crate) text: &'a str,
}

/// `Entry`, borrowed from whichever side joined it.
pub(crate) struct EntryRef<'a> {
    pub(crate) name: &'a str,
    pub(crate) kind: &'a str,
    pub(crate) at: &'a str,
    pub(crate) declared: &'a str,
    pub(crate) line: u32,
    pub(crate) signature: Option<&'a str>,
    pub(crate) doc: Option<&'a str>,
    pub(crate) used_by: Vec<&'a str>,
    pub(crate) uses: u32,
    pub(crate) sites: Vec<UseRef<'a>>,
    pub(crate) through_default: Vec<UseRef<'a>>,
    pub(crate) mention: Option<MentionRef<'a>>,
}

/// `Opening`, borrowed, with the specifier a search line prints for it.
pub(crate) struct OpeningRef<'a> {
    pub(crate) subpath: &'a str,
    pub(crate) source: &'a str,
    pub(crate) spec: &'a str,
    pub(crate) entries: Vec<EntryRef<'a>>,
    pub(crate) whole: Vec<UseRef<'a>>,
}

/// `Documented`, borrowed.
pub(crate) struct PackageRef<'a> {
    pub(crate) name: &'a str,
    pub(crate) entry: bool,
    pub(crate) openings: Vec<OpeningRef<'a>>,
}

impl<'a> From<&'a StorePackage> for PackageRef<'a> {
    fn from(held: &'a StorePackage) -> Self {
        let uses = |held: &'a [StoreUse]| held.iter().map(UseRef::from).collect();
        PackageRef {
            name: &held.name,
            entry: held.entry,
            openings: held.openings.iter().map(|opening| OpeningRef {
                subpath: &opening.subpath,
                source: &opening.source,
                spec: &opening.spec,
                entries: opening.entries.iter().map(|entry| EntryRef {
                    name: &entry.name,
                    kind: &entry.kind,
                    at: &entry.at,
                    declared: &entry.declared,
                    line: entry.line,
                    signature: entry.signature.as_deref(),
                    doc: entry.doc.as_deref(),
                    used_by: entry.used_by.iter().map(String::as_str).collect(),
                    uses: entry.uses,
                    sites: uses(&entry.sites),
                    through_default: uses(&entry.through_default),
                    mention: entry.mention.as_ref().map(|held| MentionRef { at: &held.at, line: held.line, text: &held.text }),
                }).collect(),
                whole: uses(&opening.whole),
            }).collect(),
        }
    }
}

pub(crate) struct DeepRef<'a> {
    pub(crate) specifier: &'a str,
    pub(crate) by: &'a str,
    pub(crate) at: &'a str,
    pub(crate) line: u32,
    pub(crate) to: Option<&'a str>,
    pub(crate) names: Vec<UseRef<'a>>,
}

impl<'a> From<&'a StoreDeep> for DeepRef<'a> {
    fn from(held: &'a StoreDeep) -> Self {
        DeepRef { specifier: &held.specifier, by: &held.by, at: &held.at, line: held.line, to: held.to.as_deref(), names: held.names.iter().map(UseRef::from).collect() }
    }
}

impl<'a> From<&'a DeepRequest> for DeepRef<'a> {
    fn from(held: &'a DeepRequest) -> Self {
        DeepRef { specifier: &held.specifier, by: &held.by, at: &held.at, line: held.line, to: held.to.as_deref(), names: held.names.iter().map(UseRef::from).collect() }
    }
}

/// What the store is encoded from: the deep imports, those by path and those
/// unfollowed, in that order.
pub(crate) struct StoreRef<'a> {
    pub(crate) packages: &'a dyn Packages,
    pub deep: [Vec<DeepRef<'a>>; 3],
    pub unreadable: &'a [String],
}

/// The packages a store is encoded from, handed over a run at a time, in
/// order: only one run's joined rows are held while it is encoded.
pub(crate) trait Packages: Sync {
    /// Every entry's name, once per entry: exactly the names `each` hands
    /// over on its entries.
    fn names(&self) -> Vec<&str>;
    /// Each run of packages, in order.
    fn each<'s>(&'s self, visit: &mut dyn FnMut(&[PackageRef<'s>]));
}

/// Packages already joined are one run.
impl Packages for Vec<PackageRef<'_>> {
    fn names(&self) -> Vec<&str> {
        self.iter().flat_map(|owner| &owner.openings).flat_map(|opening| &opening.entries).map(|entry| entry.name).collect()
    }

    fn each<'s>(&'s self, visit: &mut dyn FnMut(&[PackageRef<'s>])) {
        visit(self);
    }
}

use crate::help_store_encode::body_of;

/// The store's bytes and the digest of `exported`: `digest` when the caller
/// holds it, computed beside the body when not.
pub(crate) fn encode(input: &StoreRef, exported: &[NamedExport], meta: Option<&StoreMeta>, digest: Option<&str>) -> (Vec<u8>, String) {
    let (body, digest) = rayon::join(|| body_of(input, exported),|| digest.map_or_else(|| exported_digest(exported), str::to_owned));
    let meta: [Option<&str>; META] = match meta {
        Some(held) => [
            Some(&held.root), Some(&held.graph_root), Some(&held.graph_digest), Some(&held.generated_at), Some(&held.read_started_at),
            // The seventh slot held a digest of the `export … from` rows, which no reader compares any more.
            Some(&digest), None, held.index_digest.as_deref(), held.packages_digest.as_deref(),
        ],
        None => [None, None, None, None, None, Some(&digest), None, None, None],
    };
    let mut columns = Vec::from(head_columns(&meta));
    columns.extend(body);
    (segment::encode_as(FORMAT, VERSION, columns), digest)
}

/// The flags of one use: type, kind, how it is read through, and whether
/// through `default` or passed on whole.
pub(crate) fn flags(held: &UseRef) -> u8 {
    let kind = USE_KINDS.iter().position(|kind| *kind == held.kind).unwrap_or(0) as u8;
    let through = match held.through {
        Some("dynamic") => 1u8,
        Some("namespace") => 2,
        _ => 0,
    };
    let mut flags = u8::from(held.r#type) | (kind << 1) | (through << 3);
    if through != 0 {
        flags |= u8::from(held.through_default) << 5 | u8::from(held.whole) << 6;
    }
    flags
}
