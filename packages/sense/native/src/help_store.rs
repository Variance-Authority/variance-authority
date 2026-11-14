//! The questions' store: one binary file beside the index holding the Help
//! value and the search over it.
//!
//! `openHelpStore` in `packages/help/src/search-index.ts` reads it. A header —
//! magic, version, the length of the head — is followed by the head: the
//! generation it belongs to as length-prefixed strings, then the place of each
//! section, in the order `SECTIONS` lists them on both sides. Sections are
//! little-endian 32-bit columns or byte runs, each 4-aligned, counted from where
//! the body starts, so a new head over the same body moves nothing in it
//! (`restamp_help_store`). Every string lives once in one pool.
//!
//! A question reads the columns it prints. The export list, 249,214 rows on
//! Kibana, is never printed as text: it was 162 MB of JSON parsed in front of
//! every name question.

// compass: variance-authority.report.agent-surface

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::help_search::exported_digest;
use crate::help_usage::{DeepRequest, NameUse, NamedExport};

const MAGIC: u32 = 0x5348_4156; // "VAHS", little-endian
const VERSION: u32 = 6;
pub(crate) const NONE: u32 = u32::MAX;
pub(crate) const USE_KINDS: [&str; 3] = ["source", "test", "story"];
/// The generation's fields, in the order the head writes them.
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
    pub forwards_digest: Option<String>,
    pub index_digest: Option<String>,
    pub packages_digest: Option<String>,
}

#[napi(object)]
pub struct EncodedStore {
    pub bytes: Buffer,
    /// sha256 over the export list as a set of file, name, kind and type: what
    /// `sameSurface` compares, kept so a later refresh compares two digests.
    pub exported: String,
}

/// Encode `store` and `exported`, stamped with `meta` when it is published.
#[napi(catch_unwind)]
pub fn encode_help_store(store: HelpStore, exported: Vec<NamedExport>, meta: Option<StoreMeta>) -> EncodedStore {
    let deep = [&store.deep, &store.by_path, &store.unfollowed].map(|held| held.iter().map(DeepRef::from).collect());
    let input = StoreRef { packages: &store.packages, deep, unreadable: &store.unreadable };
    let (bytes, digest) = encode(&input, &exported, meta.as_ref(), None);
    EncodedStore { bytes: bytes.into(), exported: digest }
}

/// The same store with a new `generatedAt`: the body is copied as it is.
#[napi(catch_unwind)]
pub fn restamp_help_store(bytes: Buffer, generated_at: String) -> napi::Result<Buffer> {
    let (mut meta, table, start) = head(&bytes).map_err(napi::Error::from_reason)?;
    meta[GENERATED_AT] = Some(generated_at);
    let fields: Vec<Option<&str>> = meta.iter().map(Option::as_deref).collect();
    let written = header(&fields, &table);
    let at = align(written.len());
    let mut out = vec![0u8; at + bytes.len() - start];
    out[..written.len()].copy_from_slice(&written);
    out[at..].copy_from_slice(&bytes[start..]);
    Ok(out.into())
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
    pub(crate) packages: &'a [StorePackage],
    pub deep: [Vec<DeepRef<'a>>; 3],
    pub unreadable: &'a [String],
}

use crate::help_store_encode::Body;

/// The store's bytes and the digest of `exported`: `digest` when the caller
/// holds it, computed beside the body when not.
pub(crate) fn encode(input: &StoreRef, exported: &[NamedExport], meta: Option<&StoreMeta>, digest: Option<&str>) -> (Vec<u8>, String) {
    let (body, digest) = rayon::join(|| Body::of(input, exported), || digest.map_or_else(|| exported_digest(exported), str::to_owned));
    let meta: [Option<&str>; META] = match meta {
        Some(held) => [
            Some(&held.root), Some(&held.graph_root), Some(&held.graph_digest), Some(&held.generated_at), Some(&held.read_started_at),
            Some(&digest), held.forwards_digest.as_deref(), held.index_digest.as_deref(), held.packages_digest.as_deref(),
        ],
        None => [None, None, None, None, None, Some(&digest), None, None, None],
    };
    let (table, bodies) = body.laid_out();
    let written = header(&meta, &table);
    let start = align(written.len());
    let size = table.last().map_or(0, |&(off, len)| align(off as usize + len as usize));
    let mut out = vec![0u8; start + size];
    out[..written.len()].copy_from_slice(&written);
    for (&(off, _), bytes) in table.iter().zip(&bodies) {
        out[start + off as usize..start + off as usize + bytes.len()].copy_from_slice(bytes);
    }
    (out, digest)
}

/// Magic, version, the head's length, then the head: each field of `meta` as
/// a length and its UTF-8, `NONE` for absent, then the sections' places.
fn header(meta: &[Option<&str>], table: &[(u32, u32)]) -> Vec<u8> {
    let mut head = Vec::new();
    for field in meta {
        match field {
            Some(text) => {
                head.extend_from_slice(&(text.len() as u32).to_le_bytes());
                head.extend_from_slice(text.as_bytes());
            }
            None => head.extend_from_slice(&NONE.to_le_bytes()),
        }
    }
    head.extend_from_slice(&(table.len() as u32).to_le_bytes());
    for &(off, len) in table {
        head.extend_from_slice(&off.to_le_bytes());
        head.extend_from_slice(&len.to_le_bytes());
    }
    let mut out = Vec::with_capacity(12 + head.len());
    out.extend_from_slice(&MAGIC.to_le_bytes());
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out
}

type Head = (Vec<Option<String>>, Vec<(u32, u32)>, usize);

/// The generation, the sections' places and where the body starts.
fn head(bytes: &[u8]) -> Result<Head, String> {
    let word = |at: usize| bytes.get(at..at + 4).map(|held| u32::from_le_bytes(held.try_into().expect("four bytes")));
    if word(0) != Some(MAGIC) || word(4) != Some(VERSION) {
        return Err(format!("not a help store v{VERSION}"));
    }
    let short = || "the help store's head is cut short".to_owned();
    let length = word(8).ok_or_else(short)? as usize;
    let mut at = 12;
    let mut meta = Vec::with_capacity(META);
    for _ in 0..META {
        let size = word(at).ok_or_else(short)?;
        at += 4;
        if size == NONE {
            meta.push(None);
            continue;
        }
        let text = bytes.get(at..at + size as usize).ok_or_else(short)?;
        meta.push(Some(String::from_utf8(text.to_vec()).map_err(|error| error.to_string())?));
        at += size as usize;
    }
    let count = word(at).ok_or_else(short)?;
    at += 4;
    let mut table = Vec::with_capacity(count as usize);
    for _ in 0..count {
        table.push((word(at).ok_or_else(short)?, word(at + 4).ok_or_else(short)?));
        at += 8;
    }
    if at != 12 + length {
        return Err(short());
    }
    Ok((meta, table, align(12 + length)))
}

pub(crate) fn align(at: usize) -> usize {
    (at + 3) & !3
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
