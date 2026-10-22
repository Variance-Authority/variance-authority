//! Installed third-party public names, indexed on the native side of the boundary.
//!
//! The source index owns observed requests. Manifests own install intent, and the resolver owns availability.
//! The lexicon is two files of its own: a catalogue of what the manifests ask for and what the installed
//! packages offer, and the requests each source file writes, kept as a log. An edit appends its files' requests
//! to the log, and the catalogue is written again only when a manifest, an installed package, or a specifier no
//! request asked for before moves it.
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::{fs, path::Path};
use napi_derive::napi;
use serde::Serialize;
#[path = "dependency_lexicon_boundary.rs"] mod boundary;
#[path = "dependency_lexicon_build.rs"] mod build;
#[path = "dependency_lexicon_catalogue.rs"] mod catalogue;
#[path = "dependency_lexicon_codec.rs"] mod codec;
#[path = "dependency_lexicon_entry.rs"] mod entry;
#[path = "dependency_lexicon_sites.rs"] mod sites;
#[path = "dependency_lexicon_stamps.rs"] mod stamps;
#[path = "dependency_lexicon_view.rs"] mod view;
#[path = "dependency_lexicon_wanted.rs"] mod wanted;
#[path = "dependency_lexicon_query.rs"]
mod query;
#[path = "dependency_stack.rs"]
mod stack;
#[path = "dependency_described.rs"]
mod describing;
#[path = "dependency_purpose.rs"]
pub(crate) mod purposes;
use purposes::Purpose;
#[path = "dependency_skills.rs"]
mod skilled;
use skilled::Skill;
use catalogue::Catalogue;
use sites::State;

#[derive(Clone, PartialEq, Eq)]
struct Identity { name: String, version: String, manifest: String }
#[derive(Clone)]
struct Name { name: String, kind: String, at: String, line: u32, signature: Option<String>, doc: Option<String> }
#[derive(Clone)]
struct Source { at: String, digest: String }
/// The `README.md` beside an installed package's manifest: where it is and how long, or why it did not read.
#[derive(Clone, Serialize)]
struct Readme {
    at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unreadable: Option<String>,
}
#[derive(Clone)]
struct Api {
    runtime: Option<Identity>,
    declarations: Option<Identity>,
    entrypoint: Option<String>,
    names: Option<Vec<Name>>,
    sources: Option<Vec<Source>>,
    unavailable: Option<String>,
    /// Only on an unavailable entry: the package's own prose may be all it ships.
    readme: Option<Readme>,
    /// What the package says it is for, read from the installed package at refresh.
    purpose: Option<Purpose>,
    /// The agent skills the package ships in `skills/`, read from the installed package at refresh.
    skills: Option<Vec<Skill>>,
}
#[derive(Clone)]
struct Owner { manifest: String, directory: String, name: String, declared: BTreeSet<String>, kinds: BTreeMap<String, &'static str> }

#[napi(object)]
pub struct LexiconRefresh {
    pub path: String,
    pub sites: String,
    pub packages: u32,
    pub entrypoints: u32,
    pub reused: u32,
    pub unavailable: u32,
    /// Entries that resolved to no entrypoint; absent when the catalogue was not written again to count them.
    pub unresolved: Option<u32>,
    /// True when the chain and the installed files were where the last refresh left them, and nothing was read.
    pub unchanged: bool,
    /// The source files whose requests this refresh recorded.
    pub appended: u32,
    /// True when the requests file was written whole, because its base or the names a request is internal to moved.
    pub rebuilt: bool,
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn failed(error: impl std::fmt::Display) -> napi::Error { napi::Error::from_reason(error.to_string()) }

/// Refresh the installed lexicon from Git, the source index and the package manager's resolver. No
/// per-dependency object crosses N-API.
#[napi(ts_return_type = "Promise<LexiconRefresh>")]
pub fn refresh_dependency_lexicon(
    root: String,
    index: String,
    path: String,
    sites: String,
    tsconfig: Option<napi::Either<String, bool>>,
) -> napi::bindgen_prelude::AsyncTask<crate::off_thread::OffThread<LexiconRefresh>> {
    let tsconfig = crate::resolve::Tsconfig::from_js(tsconfig);
    crate::off_thread::off_thread(move || refresh(root, index, path, sites, tsconfig))
}

/// What the requests file is to hold after a refresh: as it was, or the bytes to write past `end`, or whole. It is
/// written after the catalogue, so a refresh that stops between the two leaves a requests file that has not seen
/// the chain, and the next refresh reads that increment again.
enum Wrote { Held, None, Appended(usize, sites::Writer), Rebuilt(Vec<u8>, sites::Writer) }

fn refresh(root: String, index: String, path: String, sites_path: String, tsconfig: crate::resolve::Tsconfig) -> napi::Result<LexiconRefresh> {
    let root_path = Path::new(&root);
    // Read before anything else, so a chain that moves during the refresh is never recorded as the one it read.
    let (chain, working) = crate::index_chain::manifest_digests(&index).map_or((None, 0), |(chain, working)| (Some(chain), working));
    let base = chain.as_ref().map_or(0, |chain| chain.len().saturating_sub(working));
    let held_catalogue = fs::read(&path).ok();
    let held_sites = fs::read(&sites_path).ok();
    let catalogue = held_catalogue.as_deref().and_then(|bytes| Catalogue::open(bytes).ok())
        // An older catalogue answers questions, but nothing in it is reused: its owners or its stems were cut another way.
        .filter(|catalogue| catalogue.older().is_none());
    let state = held_sites.as_deref().and_then(State::read);
    let based = |state: &State| chain.as_ref().is_some_and(|chain| state.base.iter().copied().eq(chain[..base].iter().map(String::as_str)));
    let seen = |state: &State| chain.as_ref().is_some_and(|chain|
        state.seen.as_ref().is_some_and(|seen| seen.iter().copied().eq(chain[base..].iter().map(String::as_str))));
    let held_stamps = catalogue.as_ref().map(Catalogue::stamps).unwrap_or_default();
    let moved = if catalogue.is_some() { stamps::moved(root_path, &held_stamps) } else { Vec::new() };
    let refreshed = |summary: [u32; 4], unchanged: bool, appended: u32, rebuilt: bool, reused: u32, unresolved: Option<u32>| LexiconRefresh {
        path: path.clone(), sites: sites_path.clone(), packages: summary[0], entrypoints: summary[1], reused,
        unavailable: summary[3], unresolved, unchanged, appended, rebuilt,
    };
    if let (Some(catalogue), Some(state)) = (catalogue.as_ref(), state.as_ref()) {
        if based(state) && seen(state) && moved.is_empty() {
            let summary = catalogue.summary();
            return Ok(refreshed(summary, true, 0, false, summary[2], None));
        }
    }

    let listed = wanted::manifests(&root).ok_or_else(|| failed(format!("git could not list the checkout at {root}")))?;
    let manifest_moved = moved.iter().any(|at| *at == "package.json" || listed.binary_search_by(|held| crate::order::code_unit(held, at)).is_ok());
    let kept = catalogue.as_ref().filter(|catalogue| !manifest_moved && catalogue.manifests().iter().copied().eq(listed.iter().map(String::as_str)));
    let (owners, internal): (Vec<Owner>, Vec<String>) = match kept {
        Some(catalogue) => (catalogue.owners(), catalogue.internal().into_iter().map(str::to_owned).collect()),
        None => (wanted::owners(root_path, &listed),
            crate::package_owners::owners(&root, &listed).packages.into_iter().map(|package| package.name).collect()),
    };
    let internal_names: HashSet<&str> = internal.iter().map(String::as_str).collect();
    let digest = sites::internal_digest(&internal_names.iter().copied().collect::<Vec<_>>());

    let sites_file = Path::new(&sites_path);
    let wrote = match chain.as_ref() {
        None => {
            if let Err(error) = fs::remove_file(sites_file) { if error.kind() != std::io::ErrorKind::NotFound { return Err(failed(error)); } }
            Wrote::None
        }
        Some(chain) => match state.as_ref().filter(|state| based(state) && state.internal == digest) {
            Some(state) if seen(state) => Wrote::Held,
            Some(state) => match sites::increment(&index, chain, base, state, &internal_names) {
                Some(writer) => Wrote::Appended(state.end, writer),
                None => rebuilt(&index, chain, base, &internal_names, &digest)?,
            },
            None => rebuilt(&index, chain, base, &internal_names, &digest)?,
        },
    };
    let (appended, rebuilt_whole) = match &wrote {
        Wrote::Appended(_, writer) => (writer.appended, false),
        Wrote::Rebuilt(_, writer) => (writer.appended, true),
        _ => (0, false),
    };
    let names: HashSet<&str> = owners.iter().map(|owner| owner.name.as_str()).collect();
    let covered = match (&wrote, catalogue.as_ref()) {
        (_, None) => false,
        (Wrote::Appended(_, writer), Some(catalogue)) => view::covers(catalogue, &owners, &names,
            writer.written.iter().map(|(file, rows)| (file.as_str(), rows.iter().map(|(package, specifier)| (package.as_str(), specifier.as_str())).collect()))),
        (Wrote::Rebuilt(bytes, _), Some(catalogue)) => State::read(bytes).is_some_and(|state| view::covers(catalogue, &owners, &names,
            state.files().map(|(file, rows)| (file, sites::sites(rows).map(|site| (site.package, site.specifier)).collect())))),
        (Wrote::Held | Wrote::None, Some(_)) => true,
    };
    if covered && kept.is_some() && moved.is_empty() {
        written(&wrote, sites_file)?;
        let summary = catalogue.as_ref().map(Catalogue::summary).unwrap_or_default();
        return Ok(refreshed(summary, false, appended, rebuilt_whole, summary[2], None));
    }

    // The catalogue is made over the requests the file holds now.
    let now = match &wrote {
        Wrote::None | Wrote::Held => None,
        Wrote::Appended(end, writer) => held_sites.as_ref().map(|held| { let mut bytes = held[..*end].to_vec(); bytes.extend_from_slice(writer.bytes()); bytes }),
        Wrote::Rebuilt(bytes, _) => Some(bytes.clone()),
    };
    let now_state = if matches!(wrote, Wrote::Held) { state } else { now.as_deref().and_then(State::read) };
    let (made, reused, unresolved) = build::made(root_path, owners, listed, internal, now_state.as_ref(), catalogue.as_ref(), tsconfig);
    sites::publish(Path::new(&path), &made.encode()).map_err(failed)?;
    written(&wrote, sites_file)?;
    Ok(refreshed(made.summary, false, appended, rebuilt_whole, reused, Some(unresolved)))
}

/// The requests file made whole over the chain's base, not yet written.
fn rebuilt(index: &str, chain: &[String], base: usize, internal: &HashSet<&str>, digest: &str) -> napi::Result<Wrote> {
    let (bytes, writer) = sites::rebuild(index, chain, base, internal, digest).ok_or_else(|| failed("the source index did not read"))?;
    Ok(Wrote::Rebuilt(bytes, writer))
}

/// Write what the requests file is to hold, once the catalogue that covers it stands.
fn written(wrote: &Wrote, file: &Path) -> napi::Result<()> {
    match wrote {
        Wrote::Appended(end, writer) => sites::append(file, *end, writer.bytes()).map_err(failed),
        Wrote::Rebuilt(bytes, _) => sites::publish(file, bytes).map_err(failed),
        Wrote::Held | Wrote::None => Ok(()),
    }
}
