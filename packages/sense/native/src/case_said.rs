//! What a case said it arranged, from the frame a realm wrote to the row a
//! reader prints: the one owner of every step after capture (ADR-0094).
//!
//! A case said a set of items, `(name, value, site, level)`. An item is kept
//! raw — every one, an overridden one too, its value the JSON text the realm
//! wrote — and joined by union, so two frames, two shards or two runs give one
//! answer whichever arrived first. A row is resolved only when it is read.
//!
//! The case index stores the items in `tests.said`: each distinct item once,
//! and the cases that said it as a set in the record's crossing-set pool.

use std::cmp::Ordering;
use std::path::Path;

use serde_json::value::RawValue;

use crate::case_owner::project_path;
use crate::crossing_sets::SetPool;
use crate::order;

/// The section's name in the case index.
pub const SECTION: &str = "tests.said";

/// What a damaged section is refused with, as every other column of the case index is.
const DAMAGED: &str = "not a variance-authority execution index";

/// One thing a case said: `[name, value, site, level]` in a frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub name: String,
    /// The JSON text the realm's `JSON.stringify` wrote, never re-spelled.
    pub value: String,
    /// The repository-relative `file:line` of the call, once named from the checkout.
    pub site: String,
    /// The describe depth of the `beforeEach` that said it; `0xffff` for the case body.
    pub level: u32,
}

/// What a case said, as every writer stores it: in [`item_order`], each item once.
pub type Said = Vec<Item>;

/// The order items are stored and joined in: name, value, level, site.
pub fn item_order(left: &Item, right: &Item) -> Ordering {
    order::code_unit(&left.name, &right.name)
        .then_with(|| order::code_unit(&left.value, &right.value))
        .then(left.level.cmp(&right.level))
        .then_with(|| site_order(&left.site, &right.site))
}

/// Sites as `file:line`, by file in code-unit order, then by line as a number.
fn site_order(left: &str, right: &str) -> Ordering {
    fn split(site: &str) -> (&str, Option<u64>) {
        match site.rfind(':') {
            Some(at) => (&site[..at], site[at + 1..].parse().ok()),
            None => (site, None),
        }
    }
    let ((left_file, left_line), (right_file, right_line)) = (split(left), split(right));
    order::code_unit(left_file, right_file).then(left_line.cmp(&right_line)).then_with(|| order::code_unit(left, right))
}

/// Items in [`item_order`], each once.
fn canonical(mut items: Vec<Item>) -> Said {
    items.sort_by(item_order);
    items.dedup();
    items
}

/// The items a frame field, or a row a writer hands over, spells:
/// `[[name, value, site, level], …]`.
pub fn parse(text: &str) -> Result<Vec<Item>, String> {
    let tuples: Vec<(String, &RawValue, String, u32)> =
        serde_json::from_str(text).map_err(|_| "not what a case said: expected [[name, value, site, level], …]".to_owned())?;
    Ok(tuples
        .into_iter()
        .map(|(name, value, site, level)| Item { name, value: value.get().to_owned(), site, level })
        .collect())
}

/// Items as a frame field spells them, each value as it was written.
pub fn spell(items: &[Item]) -> String {
    let text = |value: &str| serde_json::Value::from(value).to_string();
    let tuples: Vec<String> =
        items.iter().map(|item| format!("[{},{},{},{}]", text(&item.name), item.value, text(&item.site), item.level)).collect();
    format!("[{}]", tuples.join(","))
}

/// What a frame owner says its case said: `None` where the writer never listened
/// — the sixth field empty or missing — and empty where the case said nothing.
pub fn of_frame(packed: &str) -> Result<Option<Vec<Item>>, String> {
    match packed.split('\0').nth(5) {
        None | Some("") => Ok(None),
        Some(field) => parse(field).map(Some).map_err(|_| "not a variance-authority case journal".to_owned()),
    }
}

/// Everything two frames, shards or runs of one case said, as one: the union.
/// `None` only where neither was listened to.
pub fn join(held: Option<Said>, said: Option<Vec<Item>>) -> Option<Said> {
    match (held, said) {
        (held, None) => held.map(canonical),
        (None, said) => said.map(canonical),
        (Some(mut held), Some(said)) => {
            held.extend(said);
            Some(canonical(held))
        }
    }
}

/// Every site named from the checkout. `root` is the checkout's absolute path.
pub fn heard(root: &Path, items: Vec<Item>) -> Said {
    canonical(items.into_iter().map(|item| Item { site: checkout_site(root, &item.site), ..item }).collect())
}

/// The row a reader prints. Per name, the narrowest level the case said it at
/// wins; each value said there is kept, two being a contradiction; a value said
/// at several sites is printed at the one first in [`site_order`].
pub fn resolve(said: &[Item]) -> Said {
    let mut row: Vec<Item> = Vec::new();
    let mut at = 0;
    while at < said.len() {
        let name = &said[at].name;
        let end = at + said[at..].iter().take_while(|item| item.name == *name).count();
        let named = &said[at..end];
        let narrowest = named.iter().map(|item| item.level).max().unwrap_or_default();
        for item in named.iter().filter(|item| item.level == narrowest) {
            match row.last_mut() {
                Some(held) if held.name == item.name && held.value == item.value => {
                    if site_order(&item.site, &held.site).is_lt() {
                        held.site.clone_from(&item.site);
                    }
                }
                _ => row.push(item.clone()),
            }
        }
        at = end;
    }
    row
}

/// The `tests.said` section for `said`, one entry per case, laying each item's
/// cases into `pool`. `None` when no case was listened to.
pub fn lay(said: &[Option<&[Item]>], pool: &mut SetPool) -> Option<Vec<u8>> {
    if said.iter().all(Option::is_none) {
        return None;
    }
    let measured: Vec<u32> = (0..said.len() as u32).filter(|case| said[*case as usize].is_some()).collect();
    let mut cases_of: Vec<(&Item, Vec<u32>)> = Vec::new();
    {
        let mut every: Vec<(&Item, u32)> = said
            .iter()
            .enumerate()
            .flat_map(|(case, items)| items.unwrap_or_default().iter().map(move |item| (item, case as u32)))
            .collect();
        every.sort_by(|(left, left_case), (right, right_case)| item_order(left, right).then(left_case.cmp(right_case)));
        every.dedup();
        for (item, case) in every {
            match cases_of.last_mut() {
                Some((held, cases)) if *held == item => cases.push(case),
                _ => cases_of.push((item, vec![case])),
            }
        }
    }
    let mut texts: Vec<&str> = cases_of.iter().flat_map(|(item, _)| [item.name.as_str(), item.value.as_str(), item.site.as_str()]).collect();
    texts.sort_unstable_by(|left, right| order::code_unit(left, right));
    texts.dedup();
    let text_id = |text: &str| texts.binary_search_by(|held| order::code_unit(held, text)).unwrap_or_default() as u32;

    let mut out = Vec::new();
    let word = |out: &mut Vec<u8>, value: u32| out.extend_from_slice(&value.to_le_bytes());
    word(&mut out, pool.intern(&measured));
    word(&mut out, texts.len() as u32);
    let mut offset = 0_u32;
    word(&mut out, offset);
    for text in &texts {
        offset += text.len() as u32;
        word(&mut out, offset);
    }
    for text in &texts {
        out.extend_from_slice(text.as_bytes());
    }
    word(&mut out, cases_of.len() as u32);
    for field in [0, 1, 2] {
        for (item, _) in &cases_of {
            word(&mut out, text_id([&item.name, &item.value, &item.site][field]));
        }
    }
    for (item, _) in &cases_of {
        word(&mut out, item.level);
    }
    let sets: Vec<u32> = cases_of.iter().map(|(_, cases)| pool.intern(cases)).collect();
    for set in sets {
        word(&mut out, set);
    }
    Some(out)
}

/// What each of `tests` cases said, off a `tests.said` section whose sets
/// `members` reads: `None` for a case no recorder listened to.
pub fn read(
    section: &[u8],
    tests: usize,
    members: impl Fn(u32) -> Result<Vec<u32>, String>,
) -> Result<Vec<Option<Said>>, String> {
    let damaged = || DAMAGED.to_owned();
    let mut at = 0_usize;
    let measured = word_at(section, &mut at)?;
    let count = word_at(section, &mut at)? as usize;
    let offsets = (0..=count).map(|_| word_at(section, &mut at)).collect::<Result<Vec<u32>, String>>()?;
    let size = *offsets.last().ok_or_else(damaged)? as usize;
    let blob = section.get(at..at + size).ok_or_else(damaged)?;
    let texts = offsets
        .windows(2)
        .map(|pair| {
            let bytes = blob.get(pair[0] as usize..pair[1] as usize).ok_or_else(damaged)?;
            std::str::from_utf8(bytes).map_err(|_| damaged())
        })
        .collect::<Result<Vec<&str>, String>>()?;
    at += size;
    let items = word_at(section, &mut at)? as usize;
    let mut columns = [(); 5].map(|()| Vec::with_capacity(items));
    for column in &mut columns {
        for _ in 0..items {
            column.push(word_at(section, &mut at)?);
        }
    }
    if at != section.len() {
        return Err(damaged());
    }
    let text = |id: u32| texts.get(id as usize).map(|text| (*text).to_owned()).ok_or_else(damaged);
    let mut said: Vec<Option<Said>> = vec![None; tests];
    for case in members(measured)? {
        *said.get_mut(case as usize).ok_or_else(damaged)? = Some(Vec::new());
    }
    let [names, values, sites, levels, sets] = columns;
    for row in 0..items {
        let item = Item { name: text(names[row])?, value: text(values[row])?, site: text(sites[row])?, level: levels[row] };
        for case in members(sets[row])? {
            said.get_mut(case as usize).and_then(Option::as_mut).ok_or_else(damaged)?.push(item.clone());
        }
    }
    Ok(said)
}

/// The little-endian word at `at`, moving past it.
fn word_at(section: &[u8], at: &mut usize) -> Result<u32, String> {
    let bytes = section.get(*at..*at + 4).ok_or_else(|| DAMAGED.to_owned())?;
    *at += 4;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// A site as every other row names a file: a path, a `file:` URL, or a dev
/// server's `/@fs/` URL becomes repository-relative.
pub fn checkout_site(root: &Path, site: &str) -> String {
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

#[cfg(test)]
#[path = "case_said_tests.rs"]
mod tests;
