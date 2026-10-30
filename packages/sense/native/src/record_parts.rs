//! The folds of the case parts beside the index: the last-run layer and the
//! Eyes journals. Each is the part one run of every shard would have written,
//! with every case named by the id the folded index gives it.
//!
//! Both are JSON, written as `case-landing.ts` and `eyes-record.ts` write them,
//! so a record the fold writes reads exactly as one a landing wrote. A part
//! that does not parse is refused: the fold says what the shards said, or
//! nothing.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::order;
use crate::record_start::{last_started, LastStart};

/// The last-run layer, its fields in the order `LastCaseRun` spells them.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Last {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    before: Option<String>,
    at: String,
    files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unbased: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "texts_in_order")]
    before_texts: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    began: Option<bool>,
    cases: Cases,
}

/// Legacy identities, or references into the case index beside this layer.
/// The object spelling refuses in older readers instead of looking like ids.
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum Cases {
    Ids(Vec<String>),
    Rows { references: Vec<Reference> },
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum Reference {
    Row(u32),
    Id(String),
}

impl Cases {
    fn resolved(&self, rows: Option<&Vec<String>>) -> Result<Vec<String>, String> {
        match self {
            Self::Ids(ids) => Ok(ids.clone()),
            Self::Rows { references } => references.iter().map(|reference| match reference {
                Reference::Id(id) => Ok(id.clone()),
                Reference::Row(row) => rows.and_then(|ids| ids.get(*row as usize)).cloned()
                    .ok_or_else(|| format!("its last-run layer names an unresolved case row: {row}")),
            }).collect(),
        }
    }
}

/// The texts by file, their files in code-unit order.
fn texts_in_order<S: serde::Serializer>(texts: &Option<BTreeMap<String, String>>, serializer: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut files: Vec<(&String, &String)> = texts.iter().flatten().collect();
    files.sort_by(|left, right| order::code_unit(left.0, right.0));
    let mut map = serializer.serialize_map(Some(files.len()))?;
    for (file, text) in files {
        map.serialize_entry(file, text)?;
    }
    map.end()
}

/// The id a shard's case is called by in the fold.
fn renamed<'a>(renamed: &'a HashMap<String, String>, id: &'a str) -> &'a str {
    renamed.get(id).map_or(id, String::as_str)
}

fn sorted(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut values: Vec<String> = values.into_iter().collect::<BTreeSet<_>>().into_iter().collect();
    values.sort_by(|left, right| order::code_unit(left, right));
    values
}

/// The commit a shard's last-run layer names, and the files it ran.
pub(crate) fn last_run(bytes: &[u8]) -> Result<(Option<String>, Vec<String>), String> {
    let last = read_last(bytes)?;
    Ok((last.commit, last.files))
}

fn read_last(bytes: &[u8]) -> Result<Last, String> {
    serde_json::from_slice(bytes).map_err(|error| format!("its last-run layer is not one this build reads: {error}"))
}

/// The shards' last-run layers as the one run they were. Each shard is
/// `(name, layer, renamed)`. The shards ran at one commit over one before
/// layer; together they ran every file any ran, and recorded every case any
/// recorded. The fold began over no index when every shard did, and a shard
/// that began over none beside one that began over a record split the suite
/// against another plan, so it fails as [`unstable`] too.
/// Shards that ran at two commits, over two before layers, or over two texts
/// of one module started from different records, and fail as [`unstable`].
pub(crate) fn fold_last(
    shards: &[(&str, &[u8], &HashMap<String, String>)],
    rows: &HashMap<String, Vec<String>>,
    combined: &[String],
) -> Result<Vec<u8>, String> {
    let read: Vec<(&str, Last, &HashMap<String, String>)> = shards
        .iter()
        .map(|(name, bytes, renames)| read_last(bytes).map(|last| (*name, last, *renames)).map_err(|error| format!("{name}: {error}")))
        .collect::<Result<_, _>>()?;
    let starts: Vec<LastStart> = read
        .iter()
        .map(|(name, last, _)| LastStart {
            shard: name,
            commit: last.commit.as_deref(),
            before: last.before.as_deref(),
            began: last.began == Some(true),
            texts: last.before_texts.as_ref(),
        })
        .collect();
    let started = last_started(&starts)?;
    let unbased = sorted(read.iter().flat_map(|(_, last, _)| last.unbased.iter().flatten().cloned()));
    let recorded = read.iter().map(|(name, last, renames)| {
        last.cases.resolved(rows.get(*name)).map(|ids| ids.into_iter().map(|id| renamed(renames, &id).to_owned()).collect::<Vec<_>>())
            .map_err(|error| format!("{name}: {error}"))
    }).collect::<Result<Vec<_>, _>>()?;
    let positions: HashMap<&str, u32> = combined.iter().enumerate().map(|(at, id)| (id.as_str(), at as u32)).collect();
    let references = sorted(recorded.into_iter().flatten()).into_iter().map(|id| {
        positions.get(id.as_str()).map_or_else(|| Reference::Id(id.clone()), |row| Reference::Row(*row))
    }).collect();
    let folded = Last {
        commit: started.commit,
        before: started.before,
        at: read.iter().map(|(_, last, _)| last.at.as_str()).max_by(|left, right| order::code_unit(left, right)).unwrap_or_default().to_owned(),
        files: sorted(read.iter().flat_map(|(_, last, _)| last.files.iter().cloned())),
        unbased: (!unbased.is_empty()).then_some(unbased),
        before_texts: (!started.texts.is_empty()).then_some(started.texts),
        began: started.began.then_some(true),
        cases: Cases::Rows { references },
    };
    let mut bytes = serde_json::to_vec_pretty(&folded).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Eyes<'a> {
    version: u32,
    watched: Vec<String>,
    #[serde(borrow)]
    journals: Vec<Journal<'a>>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Journal<'a> {
    case: String,
    attempt: u64,
    #[serde(borrow)]
    journal: &'a RawValue,
}

#[derive(Serialize)]
struct EyesOut<'a> {
    version: u32,
    watched: Vec<String>,
    journals: Vec<Journal<'a>>,
}

/// The shards' Eyes as the one run they were: every case watched by any, and
/// each case's journal for each attempt. An attempt of a case ran in one shard,
/// so two shards that hold different journals for it are refused, naming
/// both, and a journal of a case the folded index, `cases`, does not hold is
/// refused as `layEyes` refuses it. `cases` is `None` when no shard kept
/// cases, and every journal is then refused.
pub(crate) fn fold_eyes(shards: &[(&str, &[u8], &HashMap<String, String>)], cases: Option<&HashSet<String>>) -> Result<Vec<u8>, String> {
    let mut watched: BTreeSet<String> = BTreeSet::new();
    let mut journals: HashMap<(String, u64), (&str, Journal<'_>)> = HashMap::new();
    for (name, bytes, renames) in shards {
        let refused = |why: &str| format!("{name}: its eyes section {why}");
        let eyes: Eyes<'_> = serde_json::from_slice(bytes).map_err(|_| refused("is not one this build reads"))?;
        if eyes.version != 1 {
            return Err(refused("is not version 1"));
        }
        watched.extend(eyes.watched.iter().map(|id| renamed(renames, id).to_owned()));
        for row in eyes.journals {
            if row.case.is_empty() || row.attempt < 1 || !row.journal.get().starts_with(['{', '[']) {
                return Err(refused("holds a row that names no case and attempt"));
            }
            let case = renamed(renames, &row.case).to_owned();
            match cases {
                Some(cases) if !cases.contains(&case) => {
                    return Err(refused(&format!("holds a journal of `{case}`, a case the combined index does not record")));
                }
                Some(_) => {}
                None => {
                    return Err(refused(&format!(
                        "holds a journal of `{case}`, and no shard kept cases, so the combined record has no case index to name it."
                    )));
                }
            }
            watched.insert(case.clone());
            let key = (case.clone(), row.attempt);
            match journals.get(&key) {
                Some((held, journal)) if journal.journal.get() != row.journal.get() => {
                    let (first, second) = if order::code_unit(held, name).is_le() { (*held, *name) } else { (*name, *held) };
                    return Err(format!(
                        "{first} and {second} hold different Eyes journals for `{case}` attempt {}, so they are not shards of one run and cannot be folded into one.",
                        row.attempt
                    ));
                }
                Some(_) => {}
                None => {
                    journals.insert(key, (name, Journal { case, attempt: row.attempt, journal: row.journal }));
                }
            }
        }
    }
    let mut journals: Vec<Journal<'_>> = journals.into_values().map(|(_, journal)| journal).collect();
    journals.sort_by(|left, right| order::code_unit(&left.case, &right.case).then(left.attempt.cmp(&right.attempt)));
    let section = EyesOut { version: 1, watched: sorted(watched), journals };
    let mut bytes = serde_json::to_vec(&section).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// A `cases.readings` section as `case-readings.ts` writes it: each case's readings, kept as written.
#[derive(Deserialize)]
struct ReadingsIn<'a> {
    #[serde(borrow, default)]
    cases: HashMap<String, &'a RawValue>,
}

/// The shards' readings sections as one: each case's readings as its shard
/// kept them, under the id the fold calls it by. A case two shards read
/// otherwise is refused, as two journals of one attempt are.
pub(crate) fn fold_readings(shards: &[(&str, &[u8], &HashMap<String, String>)], cases: &HashSet<String>) -> Result<Vec<u8>, String> {
    let mut held: HashMap<String, (&str, &RawValue)> = HashMap::new();
    for (name, bytes, renames) in shards {
        let section: ReadingsIn<'_> = serde_json::from_slice(bytes).map_err(|_| format!("{name}: its readings section is not one this build reads"))?;
        for (id, readings) in section.cases {
            let case = renamed(renames, &id).to_owned();
            if !cases.contains(&case) {
                return Err(format!("{name}: its readings section holds readings of `{case}`, a case the combined index does not record"));
            }
            match held.get(&case) {
                Some((other, kept)) if kept.get() != readings.get() => {
                    let (first, second) = if order::code_unit(other, name).is_le() { (*other, *name) } else { (*name, *other) };
                    return Err(format!("{first} and {second} hold different readings of `{case}`, so they are not shards of one run and cannot be folded into one."));
                }
                Some(_) => {}
                None => {
                    held.insert(case, (name, readings));
                }
            }
        }
    }
    let mut ids: Vec<&String> = held.keys().collect();
    ids.sort_by(|left, right| order::code_unit(left, right));
    let mut bytes = b"{\"cases\":{".to_vec();
    for (at, id) in ids.into_iter().enumerate() {
        if at > 0 {
            bytes.push(b',');
        }
        bytes.extend(serde_json::to_vec(id).map_err(|error| error.to_string())?);
        bytes.push(b':');
        bytes.extend(held[id].1.get().as_bytes());
    }
    bytes.extend(b"}}");
    Ok(bytes)
}

#[cfg(test)]
#[path = "record_parts_tests.rs"]
mod tests;
