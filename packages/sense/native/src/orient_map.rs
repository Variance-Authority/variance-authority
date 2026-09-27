//! The code map of a checkout, prepared when `variance index` publishes the
//! source index and read back a page at a time by `variance ask orient`.
//!
//! The package graph is folded into nested areas (`orient_map_tree.rs`), each
//! area named and described (`orient_map_pages.rs`), and every page is written
//! beside the index as one JSON document carrying the digest of the index
//! manifest it was folded from. A question reads that document and nothing
//! else, so its cost is one page whatever the size of the repository, and a
//! map older than the index it describes says so rather than passing for
//! current.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::index_chain::read_chain;
use crate::orient_map_pages::{layers, names, number, pages, Page, Row};
use crate::orient_map_read::{read, Read};
use crate::orient_map_signals::signals;
use crate::orient_map_tree::tree;

const FORMAT: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Stored {
    format: u32,
    /// sha256 of the index manifest the map was folded from.
    index: String,
    layers: u32,
    pages: Vec<Page>,
}

/// Where the map of the index at `index` is kept.
fn map_path(index: &str) -> String {
    format!("{index}.map")
}

fn manifest_digest(index: &str) -> Option<String> {
    let bytes = std::fs::read(index).ok()?;
    Some(Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect())
}

/// What preparing the map made of the checkout.
#[napi(object)]
pub struct OrientMapPrepared {
    pub packages: u32,
    pub areas: u32,
    /// How many areas deep the deepest package sits.
    pub levels: u32,
    pub layers: u32,
    /// Counted files the index holds no parse for: their imports are not on the map.
    pub unread: u32,
    /// Git could not list the checkout, so its files were listed off the disk.
    pub walked: bool,
}

/// Fold the index at `index` into the code map and write it beside the index.
/// `undefined` when there is no index, or no named package to fold: then no
/// map is written, and one left from before is removed rather than read as
/// this index's.
#[napi(catch_unwind)]
pub fn prepare_orient_map(root: String, index: String) -> napi::Result<Option<OrientMapPrepared>> {
    let fail = |error: String| napi::Error::from_reason(format!("the code map of {index} was not prepared: {error}"));
    let (chain, snapshot, made) = std::thread::scope(|scope| {
        let snapshot = scope.spawn(|| crate::git::snapshot(&root));
        let made = scope.spawn(|| {
            crate::git::git(&root, &["ls-files", "-z", ":(attr:linguist-generated)", ":(attr:linguist-vendored)"], None)
        });
        (read_chain(&index), snapshot.join().ok().flatten(), made.join().ok().flatten())
    });
    let Some(chain) = chain.map_err(fail)? else { return Ok(None) };
    // Git owns the file list and the generated and vendored marks. Outside a
    // checkout git answers neither: the files are then listed off the disk,
    // nothing is marked, and the result says so.
    let walked = snapshot.is_none();
    let paths = match snapshot {
        Some(snapshot) => snapshot.paths,
        None => on_disk(&root),
    };
    let made: HashSet<String> = made
        .unwrap_or_default()
        .split(|&byte| byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect();
    let digest = manifest_digest(&index).ok_or_else(|| fail("the manifest could not be read again".to_owned()))?;
    let layers_read: Vec<Layer> = chain
        .segments
        .iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<_, _>>()
        .map_err(fail)?;
    let read = read(&root, &layers_read, &paths, &made);
    let path = map_path(&index);
    let Some((stored, levels)) = fold(&read, digest) else {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    };
    let text = serde_json::to_vec(&stored).map_err(|error| fail(error.to_string()))?;
    let written = format!("{path}.{}", std::process::id());
    std::fs::write(&written, text).and_then(|()| std::fs::rename(&written, &path)).map_err(|error| fail(error.to_string()))?;
    Ok(Some(OrientMapPrepared {
        packages: stored.pages[0].packages,
        areas: stored.pages.len() as u32 - 1,
        levels,
        layers: stored.layers,
        unread: read.unread,
        walked,
    }))
}

/// Every file under `root`, repository-relative and in code-unit order, for a
/// directory git cannot list. Hidden entries and `node_modules` are skipped,
/// as the source scan's own walk skips them.
fn on_disk(root: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut pending = vec![String::new()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(std::path::Path::new(root).join(&directory)) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let path = if directory.is_empty() { name } else { format!("{directory}/{name}") };
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(path),
                Ok(kind) if kind.is_file() => found.push(path),
                _ => {}
            }
        }
    }
    found.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    found
}

/// The map's pages, and how deep the deepest package sits; `None` when there
/// is no package to fold.
fn fold(read: &Read, digest: String) -> Option<(Stored, u32)> {
    let signals = signals(read);
    if signals.packages.is_empty() {
        return None;
    }
    let root = tree(&signals);
    let mut importers = vec![0u32; read.packages.len()];
    for &(_, b, _) in &read.edges {
        importers[b as usize] += 1;
    }
    let mut named = Vec::new();
    names(&root, &signals, read, &importers, &mut named);
    let areas = number(&root, &named);
    let (layer, count) = layers(read);
    let pages = pages(read, &signals, &areas, &layer);
    let levels = areas.iter().map(|area| if area.id.is_empty() { 0 } else { area.id.split('.').count() as u32 }).max().unwrap_or(0);
    Some((Stored { format: FORMAT, index: digest, layers: count, pages }, levels))
}

/// One row of a page, as `variance ask orient` prints it.
#[napi(object)]
pub struct OrientMapRow {
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    pub median: u32,
    pub incoming: u32,
    pub front: Vec<OrientMapShare>,
    pub more: u32,
    pub outgoing: u32,
    pub uses: Vec<OrientMapShare>,
}

/// A package or an area, and how many files the share is of.
#[napi(object)]
pub struct OrientMapShare {
    pub name: String,
    pub files: u32,
}

#[napi(object)]
pub struct OrientMapPage {
    /// `''` for the top page.
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    /// Packages on this page no area inside it took.
    pub alone: u32,
    pub rows: Vec<OrientMapRow>,
    /// An area with no areas inside it lists its packages.
    pub list: Vec<String>,
}

#[napi(object)]
pub struct OrientMapAnswer {
    /// Whether the map was folded from the index as it stands now.
    pub current: bool,
    pub layers: u32,
    /// `undefined` when the map has no area by the id asked.
    pub page: Option<OrientMapPage>,
}

/// One page of the map kept beside the index at `index`: the top one, or the
/// area `area`. `undefined` when no map is kept there.
#[napi(catch_unwind)]
pub fn orient_map_page(index: String, area: Option<String>) -> napi::Result<Option<OrientMapAnswer>> {
    let path = map_path(&index);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(napi::Error::from_reason(format!("the code map at {path} did not read: {error}"))),
    };
    let stored: Stored = serde_json::from_slice(&bytes)
        .map_err(|error| napi::Error::from_reason(format!("the code map at {path} did not read: {error}")))?;
    if stored.format != FORMAT {
        return Ok(None);
    }
    let current = manifest_digest(&index).as_deref() == Some(stored.index.as_str());
    let wanted = area.unwrap_or_default();
    let share = |(name, files): (String, u32)| OrientMapShare { name, files };
    let page = stored.pages.into_iter().find(|page| page.id == wanted).map(|page| OrientMapPage {
        id: page.id,
        name: page.name,
        packages: page.packages,
        files: page.files,
        low: page.low,
        high: page.high,
        alone: page.alone,
        rows: page
            .rows
            .into_iter()
            .map(|row: Row| OrientMapRow {
                id: row.id,
                name: row.name,
                packages: row.packages,
                files: row.files,
                low: row.low,
                high: row.high,
                median: row.median,
                incoming: row.incoming,
                front: row.front.into_iter().map(share).collect(),
                more: row.more,
                outgoing: row.outgoing,
                uses: row.uses.into_iter().map(share).collect(),
            })
            .collect(),
        list: page.list,
    });
    Ok(Some(OrientMapAnswer { current, layers: stored.layers, page }))
}

#[cfg(all(test, unix))]
#[path = "orient_map_tests.rs"]
mod tests;
