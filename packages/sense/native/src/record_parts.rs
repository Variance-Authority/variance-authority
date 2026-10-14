//! The folds of the case parts beside the index: the last-run layer and the
//! Eyes journals. Each is the part one run of every shard would have written,
//! with every case named by the id the folded index gives it.
//!
//! Both are JSON, written as `case-landing.ts` and `eyes-record.ts` write them,
//! so a record the fold writes reads exactly as one a landing wrote. A part a
//! shard holds and this build cannot read is refused: the fold says what the
//! shards said, or nothing.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::order;
use crate::record_combine::Agreed;

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
    cases: Vec<String>,
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
    let last: Last = serde_json::from_slice(bytes).map_err(|error| format!("its last-run layer is not one this build reads: {error}"))?;
    if last.began == Some(false) {
        return Err("its last-run layer spells began as false".to_owned());
    }
    Ok(last)
}

/// The shards' last-run layers as the one run they were. Each shard is
/// `(name, layer, renamed)`. The shards ran at one commit over one before
/// layer; together they ran every file any ran, and recorded every case any
/// recorded. The fold began over no index only when every shard did; a file
/// of a shard that began is then a file the before layer cannot answer for.
pub(crate) fn fold_last(shards: &[(&str, &[u8], &HashMap<String, String>)]) -> Result<Vec<u8>, String> {
    let read: Vec<(&str, Last, &HashMap<String, String>)> = shards
        .iter()
        .map(|(name, bytes, renames)| read_last(bytes).map(|last| (*name, last, *renames)).map_err(|error| format!("{name}: {error}")))
        .collect::<Result<_, _>>()?;
    let (_, held, _) = read.first().ok_or("folding last-run layers needs at least one")?;
    let (mut commit, mut before) = (Agreed::new("commit"), Agreed::new("before layer's commit"));
    for (name, last, _) in &read {
        commit.hear(name, last.commit.as_deref())?;
        before.hear(name, last.before.as_deref())?;
    }
    let every_began = read.iter().all(|(_, last, _)| last.began == Some(true));
    let mut texts: BTreeMap<String, (String, &str)> = BTreeMap::new();
    for (name, last, _) in &read {
        for (file, text) in last.before_texts.iter().flatten() {
            match texts.get(file) {
                Some((held, by)) if held != text => {
                    return Err(format!(
                        "`{file}` stood on different text before {by} and before {name}, so they are not shards of one run and cannot be folded into one."
                    ));
                }
                Some(_) => {}
                None => {
                    texts.insert(file.clone(), (text.clone(), name));
                }
            }
        }
    }
    let unbased = sorted(read.iter().flat_map(|(_, last, _)| {
        let began = !every_began && last.began == Some(true);
        last.unbased.iter().flatten().chain(last.files.iter().filter(move |_| began)).cloned()
    }));
    let folded = Last {
        commit: held.commit.clone(),
        before: held.before.clone(),
        at: read.iter().map(|(_, last, _)| last.at.as_str()).max_by(|left, right| order::code_unit(left, right)).unwrap_or_default().to_owned(),
        files: sorted(read.iter().flat_map(|(_, last, _)| last.files.iter().cloned())),
        unbased: (!unbased.is_empty()).then_some(unbased),
        before_texts: (!texts.is_empty()).then(|| texts.into_iter().map(|(file, (text, _))| (file, text)).collect()),
        began: every_began.then_some(true),
        cases: sorted(read.iter().flat_map(|(_, last, renames)| last.cases.iter().map(|id| renamed(renames, id).to_owned()))),
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
/// both, and a journal of a case the folded index does not hold, `cases`, is
/// refused as `layEyes` refuses it.
pub(crate) fn fold_eyes(shards: &[(&str, &[u8], &HashMap<String, String>)], cases: &HashSet<String>) -> Result<Vec<u8>, String> {
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
            if !cases.contains(&case) {
                return Err(refused(&format!("holds a journal of `{case}`, a case the combined index does not record")));
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

#[cfg(test)]
#[path = "record_parts_tests.rs"]
mod tests;
