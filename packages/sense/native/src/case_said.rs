//! What a case said it arranged and what the code read while it ran, from the
//! frame a realm wrote to the row a reader prints: the one owner of every step
//! after capture (ADR-0094, spec 0102).
//!
//! A case holds two facets of items, `(name, value, site, level)`: what it
//! *said* through `variancePrecondition`, and what the code *read* through
//! `varianceBreadcrumb`. Each facet is measured on its own — a record from
//! before breadcrumbs listened to what cases said and to no read — and absent
//! is not empty in either. An item is kept raw — every one, an overridden one
//! too, its value the JSON text the realm wrote — and joined by union, so two
//! frames, two shards or two runs give one answer whichever arrived first. A
//! row is resolved only when it is read.
//!
//! The case index stores each facet in its own section, `tests.said` and
//! `tests.read`, of one layout: each distinct item once, and the cases that
//! hold it as a set in the record's crossing-set pool.

use std::cmp::Ordering;
use std::path::Path;

use serde::Deserialize;

use crate::case_owner::project_path;
use crate::crossing_sets::SetPool;
use crate::order;

/// The name a `varianceBreadcrumb` call that made no `dimension:key` is read
/// under, which no `dimension:key` is; its value is what was wrong, as JSON text.
pub const MISUSED: &str = "";

/// The section what each case said is laid in.
pub const SAID_SECTION: &str = "tests.said";

/// The section what the code read in each case is laid in.
pub const READ_SECTION: &str = "tests.read";

/// What a damaged section is refused with, as every other column of the case index is.
const DAMAGED: &str = "not a variance-authority execution index";

/// The value column's word for a value JSON cannot hold: no text id reaches it.
const UNRECORDED: u32 = u32::MAX;

/// One thing a case said, or one read the code made: `[name, value, site, level]` in a frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// `dimension:key`, split at the first `:`.
    pub name: String,
    /// The JSON text the realm's `JSON.stringify` wrote, never re-spelled;
    /// `None` for a value JSON cannot hold, recorded as *unrecorded*.
    pub value: Option<String>,
    /// The repository-relative `file:line` of the call, once named from the checkout.
    pub site: String,
    /// Where the call ran: the describe depth of the `beforeEach` that said it,
    /// or of the scope a read ran in — `0` the file's, a read while the file
    /// loaded among them — and `0xffff` for the case itself.
    pub level: u32,
}

/// What one case said and what the code read in it, each in [`item_order`],
/// each item once; a facet is `None` where nobody listened to it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Heard {
    pub said: Option<Vec<Item>>,
    pub read: Option<Vec<Item>>,
}

impl Heard {
    /// Whether neither facet was listened to.
    fn unheard(&self) -> bool {
        self.said.is_none() && self.read.is_none()
    }

    fn map(self, each: impl Fn(Vec<Item>) -> Vec<Item>) -> Heard {
        Heard { said: self.said.map(&each), read: self.read.map(&each) }
    }
}

/// The order items are stored and joined in: name, value, level, site; an
/// unrecorded value after every recorded one.
pub fn item_order(left: &Item, right: &Item) -> Ordering {
    order::code_unit(&left.name, &right.name)
        .then_with(|| value_order(left.value.as_deref(), right.value.as_deref()))
        .then(left.level.cmp(&right.level))
        .then_with(|| site_order(&left.site, &right.site))
}

fn value_order(left: Option<&str>, right: Option<&str>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => order::code_unit(left, right),
        (left, right) => right.is_some().cmp(&left.is_some()),
    }
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
fn canonical(mut items: Vec<Item>) -> Vec<Item> {
    items.sort_by(item_order);
    items.dedup();
    items
}

/// A facet as a frame spells it: `[[name, value, site, level], …]`, the value
/// the JSON text as a string, `null` where it was unrecorded.
type Tuples = Vec<(String, Option<String>, String, u32)>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Spelled {
    said: Option<Tuples>,
    read: Option<Tuples>,
}

/// What a frame field, or a row a writer hands over, spells:
/// `{"said": [[name, value, site, level], …], "read": […]}`, a facet absent
/// where nobody listened to it.
pub fn parse(text: &str) -> Result<Heard, String> {
    let spelled: Spelled = serde_json::from_str(text)
        .map_err(|_| r#"not what a case heard: expected {"said": [[name, value, site, level], …], "read": […]}"#.to_owned())?;
    let items = |tuples: Tuples| {
        tuples.into_iter().map(|(name, value, site, level)| Item { name, value, site, level }).collect::<Vec<Item>>()
    };
    Ok(Heard { said: spelled.said.map(items), read: spelled.read.map(items) })
}

/// What a case heard as a frame field spells it, each value as it was written.
pub fn spell(heard: &Heard) -> String {
    let text = |value: &str| serde_json::Value::from(value).to_string();
    let facet = |items: &[Item]| {
        let tuples: Vec<String> = items
            .iter()
            .map(|item| {
                let value = item.value.as_deref().map_or_else(|| "null".to_owned(), text);
                format!("[{},{},{},{}]", text(&item.name), value, text(&item.site), item.level)
            })
            .collect();
        format!("[{}]", tuples.join(","))
    };
    let facets: Vec<String> = [("said", &heard.said), ("read", &heard.read)]
        .into_iter()
        .filter_map(|(key, items)| items.as_deref().map(|items| format!("\"{key}\":{}", facet(items))))
        .collect();
    format!("{{{}}}", facets.join(","))
}

/// What a frame owner says its case heard: `None` where the writer listened to
/// nothing — the sixth field empty or missing — and an empty facet where the
/// case said, or read, nothing.
pub fn of_frame(packed: &str) -> Result<Option<Heard>, String> {
    match packed.split('\0').nth(5) {
        None | Some("") => Ok(None),
        Some(field) => {
            let heard = parse(field).map_err(|_| "not a variance-authority case journal".to_owned())?;
            Ok(Some(heard).filter(|heard| !heard.unheard()))
        }
    }
}

/// Everything two frames, shards or runs of one case heard, as one: the union
/// of each facet. A facet is `None` only where neither listened to it, and the
/// whole is `None` only where neither listened to anything.
pub fn join(held: Option<Heard>, more: Option<Heard>) -> Option<Heard> {
    let facet = |held: Option<Vec<Item>>, more: Option<Vec<Item>>| match (held, more) {
        (held, None) => held.map(canonical),
        (None, more) => more.map(canonical),
        (Some(mut held), Some(more)) => {
            held.extend(more);
            Some(canonical(held))
        }
    };
    let (held, more) = (held.unwrap_or_default(), more.unwrap_or_default());
    Some(Heard { said: facet(held.said, more.said), read: facet(held.read, more.read) }).filter(|heard| !heard.unheard())
}

/// Every site named from the checkout. `root` is the checkout's absolute path.
pub fn heard(root: &Path, heard: Heard) -> Heard {
    heard.map(|items| canonical(items.into_iter().map(|item| Item { site: checkout_site(root, &item.site), ..item }).collect()))
}

/// A `varianceBreadcrumb` call that made no `dimension:key`: where it was
/// called and what was wrong with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Misuse {
    pub site: String,
    pub why: String,
}

/// The row a reader prints: what a case said and what the code read, each
/// resolved, and each misused breadcrumb apart from the reads.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Row {
    pub said: Option<Vec<Item>>,
    pub read: Option<Vec<Item>>,
    /// Each `(site, why)` once, by site; empty where nothing was misused.
    pub misused: Vec<Misuse>,
}

/// The row a reader prints.
///
/// What a case said: per name, the narrowest level the case said it at wins;
/// each value said there is kept, two being a contradiction.
///
/// What the code read: every value read under a name is kept, a key read with
/// two values being two reads; of one value, the narrowest level it was read
/// at — the case over the file's load.
///
/// In both, a value held at several sites is printed at the one first in
/// [`site_order`]. A read under [`MISUSED`] is no read: it is a misuse, kept
/// once per site and reason at any level.
pub fn resolve(heard: &Heard) -> Row {
    let (misused, read): (Vec<Item>, Vec<Item>) =
        heard.read.as_deref().unwrap_or_default().iter().cloned().partition(|item| item.name == MISUSED);
    let mut misused: Vec<Misuse> = misused
        .into_iter()
        .map(|item| Misuse {
            why: item.value.as_deref().and_then(|value| serde_json::from_str::<String>(value).ok()).unwrap_or_default(),
            site: item.site,
        })
        .collect();
    misused.sort_by(|left, right| site_order(&left.site, &right.site).then_with(|| order::code_unit(&left.why, &right.why)));
    misused.dedup();
    Row {
        said: heard.said.as_deref().map(|said| narrowest(said, |left, right| left.name == right.name)),
        read: heard.read.as_ref().map(|_| narrowest(&read, |left, right| left.name == right.name && left.value == right.value)),
        misused,
    }
}

/// A resolved row as a reader is handed it: the facets as [`spell`] spells
/// them, and `"misused": [{"site", "why"}, …]` beside them where any was.
pub fn spell_row(row: &Row) -> String {
    let facets = spell(&Heard { said: row.said.clone(), read: row.read.clone() });
    if row.misused.is_empty() {
        return facets;
    }
    let text = |value: &str| serde_json::Value::from(value).to_string();
    let misused: Vec<String> =
        row.misused.iter().map(|misuse| format!("{{\"site\":{},\"why\":{}}}", text(&misuse.site), text(&misuse.why))).collect();
    let joint = if facets == "{}" { "" } else { "," };
    format!("{}{joint}\"misused\":[{}]}}", &facets[..facets.len() - 1], misused.join(","))
}

/// Of each run of `items` alike under `alike`, the items at its narrowest
/// level, one per value, at its first site.
fn narrowest(items: &[Item], alike: impl Fn(&Item, &Item) -> bool) -> Vec<Item> {
    let mut row: Vec<Item> = Vec::new();
    let mut at = 0;
    while at < items.len() {
        let end = at + items[at..].iter().take_while(|item| alike(item, &items[at])).count();
        let run = &items[at..end];
        let level = run.iter().map(|item| item.level).max().unwrap_or_default();
        for item in run.iter().filter(|item| item.level == level) {
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

/// The `tests.said` and `tests.read` sections for `heard`, one entry per case,
/// laying each item's cases into `pool`: each `None` where no case was
/// listened to for it.
pub fn lay(heard: &[Option<&Heard>], pool: &mut SetPool) -> (Option<Vec<u8>>, Option<Vec<u8>>) {
    let said: Vec<Option<&[Item]>> = heard.iter().map(|heard| heard.and_then(|heard| heard.said.as_deref())).collect();
    let read: Vec<Option<&[Item]>> = heard.iter().map(|heard| heard.and_then(|heard| heard.read.as_deref())).collect();
    let said = lay_facet(&said, pool);
    (said, lay_facet(&read, pool))
}

/// One facet's section, in the layout ADR-0094 names.
fn lay_facet(facet: &[Option<&[Item]>], pool: &mut SetPool) -> Option<Vec<u8>> {
    if facet.iter().all(Option::is_none) {
        return None;
    }
    let measured: Vec<u32> = (0..facet.len() as u32).filter(|case| facet[*case as usize].is_some()).collect();
    let mut cases_of: Vec<(&Item, Vec<u32>)> = Vec::new();
    {
        let mut every: Vec<(&Item, u32)> = facet
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
    let mut texts: Vec<&str> = cases_of
        .iter()
        .flat_map(|(item, _)| [Some(item.name.as_str()), item.value.as_deref(), Some(item.site.as_str())])
        .flatten()
        .collect();
    texts.sort_unstable_by(|left, right| order::code_unit(left, right));
    texts.dedup();
    let text_id = |text: Option<&str>| match text {
        Some(text) => texts.binary_search_by(|held| order::code_unit(held, text)).unwrap_or_default() as u32,
        None => UNRECORDED,
    };

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
            word(&mut out, text_id([Some(item.name.as_str()), item.value.as_deref(), Some(item.site.as_str())][field]));
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

/// What each of `tests` cases heard, off its `tests.said` and `tests.read`
/// sections, absent where the record holds none, whose sets `members` reads:
/// `None` for a case no recorder listened to.
pub fn read(
    said: Option<&[u8]>,
    read: Option<&[u8]>,
    tests: usize,
    members: impl Fn(u32) -> Result<Vec<u32>, String>,
) -> Result<Vec<Option<Heard>>, String> {
    let facet = |section: Option<&[u8]>| match section {
        Some(section) => read_facet(section, tests, &members),
        None => Ok(vec![None; tests]),
    };
    let (said, read) = (facet(said)?, facet(read)?);
    Ok(said
        .into_iter()
        .zip(read)
        .map(|(said, read)| Some(Heard { said, read }).filter(|heard| !heard.unheard()))
        .collect())
}

/// One facet's items for each case, off its section.
fn read_facet(
    section: &[u8],
    tests: usize,
    members: &impl Fn(u32) -> Result<Vec<u32>, String>,
) -> Result<Vec<Option<Vec<Item>>>, String> {
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
    let mut facet: Vec<Option<Vec<Item>>> = vec![None; tests];
    for case in members(measured)? {
        *facet.get_mut(case as usize).ok_or_else(damaged)? = Some(Vec::new());
    }
    let [names, values, sites, levels, sets] = columns;
    for row in 0..items {
        let value = if values[row] == UNRECORDED { None } else { Some(text(values[row])?) };
        let item = Item { name: text(names[row])?, value, site: text(sites[row])?, level: levels[row] };
        for case in members(sets[row])? {
            facet.get_mut(case as usize).and_then(Option::as_mut).ok_or_else(damaged)?.push(item.clone());
        }
    }
    Ok(facet)
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
