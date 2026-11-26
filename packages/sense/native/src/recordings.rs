//! The recordings a checkout keeps, found as every reader finds them: from
//! the checkout's cache layers and the suites its configuration declares.

// compass: variance-authority.reach

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::checkout_layers::{config_read, Layers};
use crate::help_symbol_line::Recorded;
use crate::help_unread::node_said;
use crate::journey_columns::FileFrame;
use crate::record_layout::LAYOUT;

/// One recording a reader reads: the suite it belongs to, none for a checkout that declares no suites.
pub(crate) struct Record {
    pub(crate) suite: Option<String>,
    pub(crate) file: PathBuf,
}

/// Every recording the checkout's configuration declares, nearest layer first;
/// `None` for a configuration whose suites this reading does not follow.
pub(crate) fn recordings(layers: &Layers, config: Option<&Value>) -> Option<Vec<Record>> {
    // This checkout's own record, else the mainline's as fetched for a suite
    // carried by `share`, else the primary checkout's unless this checkout's
    // read was handed on: the order `nearestRecord` reads them in.
    let nearest = |inside: &Path, suite: Option<&str>, shared: bool| -> Option<PathBuf> {
        let own = layers.top.join(inside);
        if own.try_exists().ok()? {
            return Some(own);
        }
        let handed = suite.is_some_and(|name| pointer(&layers.cache, name).is_some_and(|pointer| pointer.handed));
        if let Some(fetched) = suite.filter(|_| shared).and_then(|name| fetched(layers, name, handed)) {
            return Some(fetched);
        }
        let base = layers.base.join(inside);
        Some(if handed || own == base || !base.try_exists().ok()? { own } else { base })
    };
    let Some(suites) = config.and_then(|config| config.get("suites")) else {
        return Some(vec![Record { suite: None, file: nearest(Path::new("coverage.bin"), None, false)? }]);
    };
    let suites = suites.as_object()?;
    if suites.is_empty() {
        return None;
    }
    let mut names: Vec<_> = suites.keys().collect();
    names.sort_unstable();
    names
        .into_iter()
        .map(|name| {
            let suite = suites.get(name)?.as_object()?;
            if !name.bytes().next()?.is_ascii_alphanumeric()
                || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
                || suite.keys().any(|key| {
                    !matches!(key.as_str(), "before" | "carry" | "ignore" | "precision" | "kind" | "relations")
                })
                || !matches!(suite.get("kind")?.as_str()?, "unit" | "integration" | "e2e" | "visual" | "job")
            {
                return None;
            }
            let inside = Path::new("suites").join(name).join("coverage.bin");
            let shared = match suite.get("carry").map(Value::as_str) {
                None | Some(Some("actions-cache")) => false,
                Some(Some("share")) => true,
                _ => return None,
            };
            let relations = suite.get("relations").map(Value::as_bool);
            if relations == Some(None) {
                return None;
            }
            if let Some(precision) = suite.get("precision") {
                match precision.as_str()? {
                    "file" | "symbol" if relations != Some(Some(false)) => {}
                    "file-use" | "function-use" | "region-use" => {}
                    _ => return None,
                }
            }
            for key in ["before", "ignore"] {
                if let Some(paths) = suite.get(key) {
                    let paths = paths.as_array()?;
                    if paths.is_empty() || paths.iter().any(|path| path.as_str().is_none_or(str::is_empty)) {
                        return None;
                    }
                }
            }
            Some(Record { suite: Some(name.clone()), file: nearest(&inside, Some(name), shared)? })
        })
        .collect()
}

/// What a fetch's `fetched.json` names: the commit the record is kept under,
/// when it was fetched, and whether another job's read was handed on here.
struct Pointer {
    commit: String,
    fetched: String,
    handed: bool,
}

/// The pointer a fetch left for `suite` in `cache`, or none when there is none or it does not read.
fn pointer(cache: &Path, suite: &str) -> Option<Pointer> {
    let text = std::fs::read(cache.join("share/read").join(suite).join("fetched.json")).ok()?;
    let value: Value = serde_json::from_slice(&text).ok()?;
    value.get("mainline")?.as_str()?;
    Some(Pointer {
        commit: value.get("commit")?.as_str()?.to_owned(),
        fetched: value.get("fetched")?.as_str()?.to_owned(),
        handed: value.get("handed").and_then(Value::as_bool) == Some(true),
    })
}

/// The newest mainline record of `suite` fetched on this machine that this
/// build opens, asked of this checkout's cache and its primary's, or of this
/// one alone when its read was handed on: `lastFetchedMainline`'s answer for
/// a reader with no selection, as every `ask` is.
fn fetched(layers: &Layers, suite: &str, handed: bool) -> Option<PathBuf> {
    let caches: &[&PathBuf] = if handed || layers.primary_cache == layers.cache {
        &[&layers.cache]
    } else {
        &[&layers.cache, &layers.primary_cache]
    };
    let mut newest: Option<(String, PathBuf)> = None;
    for cache in caches {
        let Some(pointer) = pointer(cache, suite) else { continue };
        if newest.as_ref().is_some_and(|(fetched, _)| *fetched >= pointer.fetched) {
            continue;
        }
        let coverage = cache.join("share/read").join(suite).join(&pointer.commit).join("coverage.bin");
        if matches!(FileFrame::open(&coverage), Ok(Some(_))) {
            newest = Some((pointer.fetched, coverage));
        }
    }
    newest.map(|(_, coverage)| coverage)
}

pub(crate) fn commit(file: &mut FileFrame) -> Result<Option<String>, String> {
    if !file.columns.iter().any(|section| section.name == "snapshot.commit") {
        if file.columns.iter().all(|section| LAYOUT.coverage.parts.iter().any(|(_, name)| *name == section.name)) {
            return Err("the record holds cases but no coverage".to_owned());
        }
        return Err("the record has no snapshot.commit section".to_owned());
    }
    let mut columns = file.selected(&["strings.blob", "strings.off", "snapshot.commit"])?;
    let commit = columns.take_words("snapshot.commit")?;
    let id = match commit.as_slice() {
        [] => return Ok(None),
        [id] => *id as usize,
        _ => return Err("the record names more than one commit".to_owned()),
    };
    let offsets = columns.take_words("strings.off")?;
    let blob = columns.held("strings.blob")?;
    let text = offsets
        .get(id)
        .zip(offsets.get(id + 1))
        .and_then(|(&start, &end)| blob.get(start as usize..end as usize))
        .ok_or("the record's commit string is out of bounds")?;
    let commit = std::str::from_utf8(text).map_err(|error| error.to_string())?;
    Ok(Some(commit.to_owned()))
}

/// The recordings `symbol --line` orders declarations by in the checkout at
/// `root`: each of [`recordings`] that keeps its cases, with the commit it ran
/// at or why it does not read; or why the recordings cannot be found.
pub(crate) fn recorded(root: &Path) -> Result<Vec<Recorded>, String> {
    let layers = Layers::found(root)?;
    let config = config_read(root)?;
    let records = recordings(&layers, config.as_ref()).ok_or(UNFOLLOWED)?;
    let mut kept = Vec::new();
    for record in records {
        let at = record.file.to_str().ok_or_else(|| format!("the recording path {} is not UTF-8", record.file.display()))?.to_owned();
        let spelled = record.file.strip_prefix(root).ok().and_then(Path::to_str).unwrap_or(&at).to_owned();
        let unread = |why: &str| Some(format!("the recording at {spelled} does not read ({})", why.lines().next().unwrap_or_default()));
        let mut file = match std::fs::File::open(&record.file) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                kept.push(Recorded { suite: record.suite, recording: at.clone(), commit: None, unread: unread(&node_said(&at, &error)) });
                continue;
            }
            Ok(_) => match FileFrame::open(&record.file) {
                Ok(Some(file)) => file,
                _ => continue,
            },
        };
        if !file.columns.iter().any(|section| section.name == LAYOUT.coverage.part("index")) { continue }
        let (commit, unread) = match commit(&mut file) {
            Ok(Some(commit)) => (Some(commit), None),
            Ok(None) => (None, Some("the recording names no commit".to_owned())),
            Err(why) => (None, unread(&why)),
        };
        kept.push(Recorded { suite: record.suite, recording: at, commit, unread });
    }
    Ok(kept)
}

/// Why [`recordings`] found none to read.
const UNFOLLOWED: &str = "the suites variance.config.json declares are not ones this reading finds the recordings of: a suite holds a value this reading does not know";
