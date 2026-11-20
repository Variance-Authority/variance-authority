//! The body of the questions' store: every column `openHelpStore` and
//! `helpOf` in `packages/help/src` read, by name.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::help_store::{flags, DeepRef, EntryRef, StoreRef, UseRef, NONE, USE_KINDS};
use crate::help_search::{headed, joined, postings, terms_of, Pool, SPLIT};
use crate::help_usage::NamedExport;
use crate::order::code_unit;
use crate::segment::{u32s, u8s, Column};

/// Rows whose text is cut or lowered at once, on every core: only one batch's
/// term sets and lowered strings are held, never every row's.
const BATCH: usize = 1 << 14;

/// `of` over `rows`, a batch at a time, in row order.
fn batched<'a, T: Sync, R: Send + 'a>(rows: &'a [T], of: impl Fn(&T) -> R + Sync + 'a) -> impl Iterator<Item = R> + 'a {
    rows.chunks(BATCH).flat_map(move |batch| batch.par_iter().map(&of).collect::<Vec<R>>())
}

/// Every distinct term once, by the id it was first met under, so a row's
/// terms are held as ids and each term's text once.
#[derive(Default)]
struct Terms {
    ids: FxHashMap<String, u32>,
}

impl Terms {
    /// Each term a row holds, as (term id, row) pairs.
    fn pairs<T: Sync>(&mut self, rows: &[T], of: impl Fn(&T) -> HashSet<String> + Sync) -> Vec<(u32, u32)> {
        let mut pairs = Vec::new();
        for (row, held) in batched(rows, of).enumerate() {
            for term in held {
                let next = self.ids.len() as u32;
                pairs.push((*self.ids.entry(term).or_insert(next), row as u32));
            }
        }
        pairs
    }

    /// The terms in byte order, and each id's place among them.
    fn sorted(self) -> (Vec<String>, Vec<u32>) {
        let mut terms: Vec<(String, u32)> = self.ids.into_iter().collect();
        terms.par_sort_unstable();
        let mut place = vec![0; terms.len()];
        for (at, (_, id)) in terms.iter().enumerate() {
            place[*id as usize] = at as u32;
        }
        (terms.into_iter().map(|(term, _)| term).collect(), place)
    }
}

/// `postings` over `count` terms from (term id, row) pairs, an id read by its
/// `place` in term byte order: a term's rows lie side by side and ascend.
fn posted(count: usize, mut pairs: Vec<(u32, u32)>, place: &[u32]) -> (Vec<u32>, Vec<u32>) {
    pairs.par_iter_mut().for_each(|pair| pair.0 = place[pair.0 as usize]);
    pairs.par_sort_unstable();
    let (mut off, mut rows, mut at) = (Vec::with_capacity(count + 1), Vec::with_capacity(pairs.len()), 0);
    for term in 0..count as u32 {
        off.push(rows.len() as u32);
        while pairs.get(at).is_some_and(|(held, _)| *held == term) {
            rows.push(pairs[at].1);
            at += 1;
        }
    }
    off.push(rows.len() as u32);
    (off, rows)
}

/// The use table's columns.
#[derive(Default)]
struct Uses {
    by: Vec<u32>,
    at: Vec<u32>,
    line: Vec<u32>,
    flags: Vec<u8>,
    through_line: Vec<u32>,
    local: Vec<u32>,
    name: Vec<u32>,
}

/// A string's id, or `NONE` when it is absent.
fn maybe<'a>(pool: &mut Pool<'a>, value: Option<&'a str>) -> u32 {
    value.map_or(NONE, |value| pool.id(value).0)
}

/// The store's columns but its head. A name's id is its place in code-unit
/// order, so a question lists names in that order by id alone.
pub(crate) fn body_of<'a>(input: &'a StoreRef<'a>, exported: &'a [NamedExport]) -> Vec<Column> {
    let split = &*SPLIT;
    let (mut strings, mut names) = (Pool::default(), Pool::default());

    // Every entry, in `everyEntry` order, with its opening's specifier.
    let entries: Vec<(&EntryRef, &str)> = input.packages.iter()
        .flat_map(|owner| owner.openings.iter())
        .flat_map(|opening| opening.entries.iter().map(move |entry| (entry, opening.spec)))
        .collect();

    let mut sorted: Vec<&str> = entries.iter().map(|(entry, _)| entry.name).chain(exported.iter().map(|named| named.name.as_str())).collect();
    sorted.par_sort_unstable_by(|a, b| code_unit(a, b));
    sorted.dedup();
    let name_string: Vec<u32> = sorted.iter().map(|name| {
        names.id(name);
        strings.id(name).0
    }).collect();
    let (mut name_pub, mut name_exp) = (vec![Vec::new(); sorted.len()], vec![Vec::<u32>::new(); sorted.len()]);
    macro_rules! name_of {
        ($name:expr) => {
            names.ids[$name]
        };
    }

    let mut uses = Uses::default();
    macro_rules! use_of {
        ($held:expr) => {{
            let held: &UseRef = $held;
            uses.by.push(strings.id(held.by).0);
            uses.at.push(strings.id(held.at).0);
            uses.line.push(held.line);
            uses.flags.push(flags(held));
            uses.through_line.push(if held.through.is_some() { held.through_line } else { 0 });
            uses.local.push(maybe(&mut strings, held.local));
            uses.name.push(maybe(&mut strings, held.name));
        }};
    }

    let rows = entries.len();
    let mut pub_cols: [Vec<u32>; 5] = Default::default(); // name, spec, kind, doc, at
    let (mut used_by_off, mut used_by) = (vec![0u32], Vec::new());
    let mut pub_uses = Vec::with_capacity(rows);
    let mut pub_more: [Vec<u32>; 6] = Default::default(); // declared, line, signature, mentionAt, mentionLine, mentionText
    for (row, (entry, spec)) in entries.iter().enumerate() {
        let name = name_of!(entry.name);
        name_pub[name as usize].push(row as u32);
        pub_cols[0].push(name);
        pub_cols[1].push(strings.id(spec).0);
        pub_cols[2].push(strings.id(&entry.kind).0);
        pub_cols[3].push(maybe(&mut strings, entry.doc));
        pub_cols[4].push(strings.id(entry.at).0);
        used_by.extend(entry.used_by.iter().map(|by| strings.id(by).0));
        used_by_off.push(used_by.len() as u32);
        pub_uses.push(entry.uses);
        pub_more[0].push(strings.id(entry.declared).0);
        pub_more[1].push(entry.line);
        pub_more[2].push(maybe(&mut strings, entry.signature));
        pub_more[3].push(maybe(&mut strings, entry.mention.as_ref().map(|held| held.at)));
        pub_more[4].push(entry.mention.as_ref().map_or(0, |held| held.line));
        pub_more[5].push(maybe(&mut strings, entry.mention.as_ref().map(|held| held.text)));
    }
    let mut sites_off = vec![0u32];
    for (entry, _) in &entries {
        for site in &entry.sites {
            use_of!(site);
        }
        sites_off.push(uses.by.len() as u32);
    }
    let mut td_off = vec![uses.by.len() as u32];
    for (entry, _) in &entries {
        for site in &entry.through_default {
            use_of!(site);
        }
        td_off.push(uses.by.len() as u32);
    }

    let (mut pkg_name, mut pkg_entry, mut pkg_open_off) = (Vec::new(), Vec::new(), vec![0u32]);
    let (mut open_subpath, mut open_source, mut open_entry_off, mut open_whole_off) = (Vec::new(), Vec::new(), vec![0u32], vec![uses.by.len() as u32]);
    let mut entry_at = 0u32;
    for owner in input.packages {
        pkg_name.push(strings.id(owner.name).0);
        pkg_entry.push(u8::from(owner.entry));
        for opening in &owner.openings {
            open_subpath.push(strings.id(opening.subpath).0);
            open_source.push(strings.id(opening.source).0);
            entry_at += opening.entries.len() as u32;
            open_entry_off.push(entry_at);
            for site in &opening.whole {
                use_of!(site);
            }
            open_whole_off.push(uses.by.len() as u32);
        }
        pkg_open_off.push(open_subpath.len() as u32);
    }

    let all: Vec<&DeepRef> = input.deep.iter().flatten().collect();
    let mut deep: [Vec<u32>; 5] = Default::default(); // specifier, by, at, line, to
    let mut deep_names_off = vec![uses.by.len() as u32];
    for held in &all {
        deep[0].push(strings.id(held.specifier).0);
        deep[1].push(strings.id(held.by).0);
        deep[2].push(strings.id(held.at).0);
        deep[3].push(held.line);
        deep[4].push(maybe(&mut strings, held.to));
        for name in &held.names {
            use_of!(name);
        }
        deep_names_off.push(uses.by.len() as u32);
    }
    let groups = vec![input.deep[0].len() as u32, (input.deep[0].len() + input.deep[1].len()) as u32, all.len() as u32];
    let unreadable: Vec<u32> = input.unreadable.iter().map(|file| strings.id(file).0).collect();

    let count = exported.len();
    let mut exp: [Vec<u32>; 9] = Default::default(); // name, at, by, line, doc, bound, declaration, boundLine, signature
    let (mut exp_kind, mut exp_type) = (Vec::with_capacity(count), Vec::with_capacity(count));
    for (row, named) in exported.iter().enumerate() {
        let name = name_of!(named.name.as_str());
        name_exp[name as usize].push(row as u32);
        exp[0].push(name);
        exp[1].push(strings.id(&named.at).0);
        exp[2].push(strings.id(&named.by).0);
        exp[3].push(named.line);
        exp[4].push(maybe(&mut strings, named.doc.as_deref()));
        exp[5].push(maybe(&mut strings, named.bound.as_deref()));
        exp[6].push(maybe(&mut strings, named.declaration.as_deref()));
        exp[7].push(named.bound_line.unwrap_or(NONE));
        exp[8].push(maybe(&mut strings, named.signature.as_deref()));
        exp_kind.push(USE_KINDS.iter().position(|kind| *kind == named.kind).map_or(u8::MAX, |at| at as u8));
        exp_type.push(u8::from(named.r#type));
    }

    // Names, then rows by doc, by export doc, by signature and by export signature.
    let mut found = Terms::default();
    let held = [
        found.pairs(&names.values, |name| terms_of(split, name)),
        found.pairs(&entries, |(entry, _)| entry.doc.map(|doc| terms_of(split, doc)).unwrap_or_default()),
        found.pairs(exported, |named| named.doc.as_deref().map(|doc| terms_of(split, doc)).unwrap_or_default()),
        found.pairs(&entries, |(entry, _)| {
            headed(&entry.kind).then_some(entry.signature).flatten().map(|signature| terms_of(split, signature)).unwrap_or_default()
        }),
        found.pairs(exported, |named| {
            let signature = named.declaration.as_deref().is_none_or(headed).then_some(named.signature.as_deref()).flatten();
            signature.map(|signature| terms_of(split, signature)).unwrap_or_default()
        }),
    ];
    let (terms, place) = found.sorted();

    let site_files = &uses.at[..*sites_off.last().unwrap_or(&0) as usize];
    let mut files: Vec<u32> = pub_cols[4].iter().chain(site_files).chain(&exp[1]).copied().collect::<HashSet<u32>>().into_iter().collect();
    files.par_sort_unstable_by(|&a, &b| strings.values[a as usize].as_bytes().cmp(strings.values[b as usize].as_bytes()));

    let (strings_off, strings_blob) = joined(&strings.values, "");
    let (lower_off, lower_blob) = joined(batched(&names.values, |name| name.to_lowercase()), "\0");
    let (doc_off, doc_blob) = joined(batched(&entries, |(entry, _)| entry.doc.unwrap_or("").to_lowercase()), "\0");
    let (exp_doc_off, exp_doc_blob) = joined(batched(exported, |named| named.doc.as_deref().unwrap_or("").to_lowercase()), "\0");
    let (terms_off, terms_blob) = joined(&terms, "");
    let lists = |lists: &[Vec<u32>]| postings(&lists.iter().map(Vec::as_slice).collect::<Vec<_>>());
    let (names_pub_off, names_pub) = lists(&name_pub);
    let (names_exp_off, names_exp) = lists(&name_exp);
    let posted: Vec<(Vec<u32>, Vec<u32>)> = held.into_iter().map(|pairs| posted(terms.len(), pairs, &place)).collect();
    let [(term_name_off, term_name), (term_pub_off, term_pub), (term_exp_off, term_exp), (term_pub_sig_off, term_pub_sig), (term_exp_sig_off, term_exp_sig)]: [_; 5] =
        posted.try_into().unwrap_or_else(|_| unreachable!("five kinds"));

    let [pub_name, pub_spec, pub_kind, pub_doc, pub_at] = pub_cols;
    let [pub_declared, pub_line, pub_signature, mention_at, mention_line, mention_text] = pub_more;
    let [exp_name, exp_at, exp_by, exp_line, exp_doc, exp_bound, exp_declaration, exp_bound_line, exp_signature] = exp;
    let [deep_specifier, deep_by, deep_at, deep_line, deep_to] = deep;
    vec![
        u32s("strings.off", strings_off), u8s("strings.blob", strings_blob), u32s("files", files),
        u32s("names.name", name_string), u32s("names.lowerOff", lower_off), u8s("names.lower", lower_blob),
        u32s("names.pubOff", names_pub_off), u32s("names.pub", names_pub), u32s("names.expOff", names_exp_off), u32s("names.exp", names_exp),
        u32s("pub.name", pub_name), u32s("pub.spec", pub_spec), u32s("pub.kind", pub_kind), u32s("pub.doc", pub_doc), u32s("pub.at", pub_at),
        u32s("pub.usedByOff", used_by_off), u32s("pub.usedByList", used_by), u32s("pub.uses", pub_uses), u32s("pub.sitesOff", sites_off), u32s("pub.tdOff", td_off),
        u32s("pub.docLowerOff", doc_off), u8s("pub.docLower", doc_blob),
        u32s("pub.declared", pub_declared), u32s("pub.line", pub_line), u32s("pub.signature", pub_signature),
        u32s("pub.mentionAt", mention_at), u32s("pub.mentionLine", mention_line), u32s("pub.mentionText", mention_text),
        u32s("exp.name", exp_name), u32s("exp.at", exp_at), u32s("exp.by", exp_by), u32s("exp.line", exp_line), u8s("exp.kind", exp_kind), u32s("exp.doc", exp_doc),
        u32s("exp.docLowerOff", exp_doc_off), u8s("exp.docLower", exp_doc_blob),
        u8s("exp.type", exp_type), u32s("exp.bound", exp_bound), u32s("exp.declaration", exp_declaration), u32s("exp.boundLine", exp_bound_line), u32s("exp.signature", exp_signature),
        u32s("use.by", uses.by), u32s("use.at", uses.at), u32s("use.line", uses.line), u8s("use.flags", uses.flags),
        u32s("use.throughLine", uses.through_line), u32s("use.local", uses.local), u32s("use.name", uses.name),
        u32s("pkg.name", pkg_name), u8s("pkg.entry", pkg_entry), u32s("pkg.openOff", pkg_open_off),
        u32s("open.subpath", open_subpath), u32s("open.source", open_source), u32s("open.entryOff", open_entry_off), u32s("open.wholeOff", open_whole_off),
        u32s("deep.specifier", deep_specifier), u32s("deep.by", deep_by), u32s("deep.at", deep_at), u32s("deep.line", deep_line), u32s("deep.to", deep_to),
        u32s("deep.namesOff", deep_names_off), u32s("deep.groups", groups),
        u32s("unreadable", unreadable),
        u32s("terms.off", terms_off), u8s("terms.blob", terms_blob),
        u32s("terms.nameOff", term_name_off), u32s("terms.name", term_name), u32s("terms.pubOff", term_pub_off), u32s("terms.pub", term_pub),
        u32s("terms.expOff", term_exp_off), u32s("terms.exp", term_exp), u32s("terms.pubSigOff", term_pub_sig_off), u32s("terms.pubSig", term_pub_sig),
        u32s("terms.expSigOff", term_exp_sig_off), u32s("terms.expSig", term_exp_sig),
    ]
}

#[cfg(test)]
#[path = "help_store_encode_tests.rs"]
mod tests;
