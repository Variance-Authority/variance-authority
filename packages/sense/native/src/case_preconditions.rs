//! What a case said it arranged: the sixth field of a frame owner, resolved as
//! `resolve` in `case-preconditions.cts` resolves it, and the
//! `tests.casePreconditions` column `case-precondition-column.ts` spells.

use std::path::Path;

use serde_json::Value;

use crate::case_owner::project_path;
use crate::order;

/// A case whose producer never listened: `UNHEARD` in `case-precondition-column.ts`.
pub const UNHEARD: u32 = 0xffff_ffff;

/// The column's name in the case index.
pub const COLUMN: &str = "tests.casePreconditions";

/// One call a case made, or one precondition its row names: `[name, value, site, level]`.
#[derive(Clone, Debug, PartialEq)]
pub struct Precondition {
    pub name: String,
    /// A string, a number or a boolean, as the call passed it.
    pub value: Value,
    pub site: String,
    /// The describe depth of the `beforeEach` that said it, `65535` for the case body.
    pub level: u32,
}

/// What a frame owner says its case arranged: `None` when a writer that never
/// listened wrote it, empty when the case said nothing. `saidOf` in `case-preconditions.cts`.
pub fn said_of(packed: &str) -> Result<Option<Vec<Precondition>>, String> {
    match packed.split('\0').nth(5) {
        None => Ok(None),
        Some("") => Ok(Some(Vec::new())),
        Some(field) => parsed(field, damaged_cases).map(Some),
    }
}

/// Every call two frames or two runs of one case carried, joined; `None` only
/// where neither was listened to. `heardAcross` in `case-precondition-column.ts`.
pub fn heard_across(held: Option<Vec<Precondition>>, said: Option<Vec<Precondition>>) -> Option<Vec<Precondition>> {
    match (held, said) {
        (held, None) => held,
        (None, said) => said,
        (Some(mut held), Some(said)) => {
            held.extend(said);
            Some(held)
        }
    }
}

/// Two runs of one case as one row, resolved as one run's calls are. `preconditionsAcross`.
pub fn across(before: Option<Vec<Precondition>>, after: Option<Vec<Precondition>>) -> Option<Vec<Precondition>> {
    heard_across(before, after).map(resolve)
}

/// The calls with each site named from the checkout. `checkoutSaid`.
pub fn checkout(root: &Path, said: Vec<Precondition>) -> Vec<Precondition> {
    said.into_iter()
        .map(|precondition| Precondition {
            site: checkout_site(root, &precondition.site),
            ..precondition
        })
        .collect()
}

/// Per name, the narrowest level wins; each distinct value said there is kept at
/// the site of the call that said it first, ordered by name, then value. `resolve`.
pub fn resolve(said: Vec<Precondition>) -> Vec<Precondition> {
    let mut resolved: Vec<(String, Precondition)> = Vec::new();
    let mut names: Vec<&str> = said.iter().map(|entry| entry.name.as_str()).collect();
    names.sort_unstable_by(|left, right| order::code_unit(left, right));
    names.dedup();
    for name in names {
        let entries = said.iter().filter(|entry| entry.name == name);
        let Some(narrowest) = entries.clone().map(|entry| entry.level).max() else {
            continue;
        };
        let mut values: Vec<(String, Precondition)> = Vec::new();
        for entry in entries.filter(|entry| entry.level == narrowest) {
            let key = value_key(&entry.value);
            if !values.iter().any(|(held, _)| *held == key) {
                values.push((key, entry.clone()));
            }
        }
        resolved.extend(values);
    }
    resolved.sort_by(|(left_key, left), (right_key, right)| {
        order::code_unit(&left.name, &right.name).then_with(|| order::code_unit(left_key, right_key))
    });
    resolved.into_iter().map(|(_, precondition)| precondition).collect()
}

/// The string the column stores a case's row as: `JSON.stringify` of its tuples.
pub fn spelled(preconditions: &[Precondition]) -> String {
    let tuples: Vec<Value> = preconditions
        .iter()
        .map(|precondition| {
            Value::Array(vec![
                Value::String(precondition.name.clone()),
                precondition.value.clone(),
                Value::String(precondition.site.clone()),
                Value::from(precondition.level),
            ])
        })
        .collect();
    Value::Array(tuples).to_string()
}

/// A row read back off the column's string. `preconditionsFrom`.
pub fn unspelled(text: &str) -> Result<Vec<Precondition>, String> {
    parsed(text, || "not a variance-authority execution index".to_owned())
}

fn parsed(text: &str, damaged: fn() -> String) -> Result<Vec<Precondition>, String> {
    let Ok(Value::Array(tuples)) = serde_json::from_str::<Value>(text) else {
        return Err(damaged());
    };
    tuples
        .into_iter()
        .map(|tuple| match tuple {
            Value::Array(fields) => match <[Value; 4]>::try_from(fields) {
                Ok([Value::String(name), value, Value::String(site), Value::Number(level)]) => Ok(Precondition {
                    name,
                    value,
                    site,
                    level: level.as_u64().and_then(|level| u32::try_from(level).ok()).ok_or_else(damaged)?,
                }),
                _ => Err(damaged()),
            },
            _ => Err(damaged()),
        })
        .collect()
}

/// `${typeof value}:${String(value)}`: one value said twice is one value, and
/// `2` and `'2'` are two.
fn value_key(value: &Value) -> String {
    match value {
        Value::String(text) => format!("string:{text}"),
        Value::Bool(flag) => format!("boolean:{flag}"),
        Value::Number(number) => format!("number:{number}"),
        other => format!("object:{other}"),
    }
}

/// A site as every other row names a file: a path, a `file:` URL, or a dev
/// server's `/@fs/` URL becomes repository-relative. `checkoutSite`.
fn checkout_site(root: &Path, site: &str) -> String {
    let Some(colon) = site.rfind(':').filter(|colon| *colon > 0) else {
        return site.to_owned();
    };
    let (spelled, line) = site.split_at(colon);
    let file = if let Some(path) = spelled.strip_prefix("file://") {
        decoded(path.split(['?', '#']).next().unwrap_or(path))
    } else if spelled.starts_with("http:") || spelled.starts_with("https:") {
        let after = spelled.split_once("://").map_or(spelled, |(_, rest)| rest);
        let path = after.find('/').map_or("", |at| &after[at..]);
        let path = path.split(['?', '#']).next().unwrap_or(path);
        // FIXME: a browser realm's site served from the dev server's root, not
        // `/@fs/`, keeps its URL — needs the server's root to name the file.
        match path.find("/@fs/") {
            Some(at) => decoded(&path[at + 4..]),
            None => return site.to_owned(),
        }
    } else {
        spelled.to_owned()
    };
    if Path::new(&file).is_absolute() {
        format!("{}{line}", project_path(root, &file))
    } else {
        site.to_owned()
    }
}

/// Percent-decoding, as `decodeURIComponent` and `fileURLToPath` read a path.
fn decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = bytes.get(at + 1..at + 3).and_then(|pair| std::str::from_utf8(pair).ok());
        match (bytes[at], hex.and_then(|pair| u8::from_str_radix(pair, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                at += 3;
            }
            (byte, _) => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn damaged_cases() -> String {
    "not a variance-authority case journal".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(name: &str, value: Value, site: &str, level: u32) -> Precondition {
        Precondition { name: name.to_owned(), value, site: site.to_owned(), level }
    }

    #[test]
    fn names_a_site_from_the_checkout_however_the_realm_spelled_it() {
        let root = Path::new("/repo");
        assert_eq!(checkout_site(root, "/repo/test/a.test.ts:3"), "test/a.test.ts:3");
        assert_eq!(checkout_site(root, "file:///repo/test/a%20b.test.ts:3"), "test/a b.test.ts:3");
        assert_eq!(checkout_site(root, "http://localhost:5173/@fs/repo/test/a.test.ts?v=1:3"), "test/a.test.ts:3");
        assert_eq!(checkout_site(root, "http://localhost:5173/src/a.test.ts:3"), "http://localhost:5173/src/a.test.ts:3");
        assert_eq!(checkout_site(root, "test/a.test.ts:3"), "test/a.test.ts:3");
    }

    #[test]
    fn spells_a_row_as_json_stringify_does() {
        let row = vec![said("n", Value::from(2), "a\u{1}:1", 65535), said("t", Value::Bool(true), "s:1", 0)];
        assert_eq!(spelled(&row), r#"[["n",2,"a\u0001:1",65535],["t",true,"s:1",0]]"#);
        assert_eq!(unspelled(&spelled(&row)).unwrap(), row);
    }

    #[test]
    fn keeps_the_first_site_of_a_value_said_twice() {
        let row = resolve(vec![said("n", Value::from("x"), "b:2", 1), said("n", Value::from("x"), "a:9", 1)]);
        assert_eq!(row, vec![said("n", Value::from("x"), "b:2", 1)]);
    }
}
