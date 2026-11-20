//! The body of the questions' store: every column `openHelpStore` and
//! `helpOf` in `packages/help/src` read, by name.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::help_store::{flags, DeepRef, EntryRef, StoreRef, UseRef, NONE, USE_KINDS};
use crate::help_search::{headed, joined, postings, terms_of, Pool, Runs, SPLIT};
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
        self.add(&mut pairs, rows, 0, of);
        pairs
    }

    /// `pairs` of rows that start at row `from`, added to `pairs`.
    fn add<T: Sync>(&mut self, pairs: &mut Vec<(u32, u32)>, rows: &[T], from: u32, of: impl Fn(&T) -> HashSet<String> + Sync) {
        for (row, held) in batched(rows, of).enumerate() {
            for term in held {
                let next = self.ids.len() as u32;
                pairs.push((*self.ids.entry(term).or_insert(next), from + row as u32));
            }
        }
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

impl Uses {
    fn len(&self) -> u32 {
        self.by.len() as u32
    }

    /// One use, its strings in `pool`.
    fn push<'a>(&mut self, pool: &mut Pool<'a>, held: &UseRef<'a>) {
        self.by.push(pool.id(held.by).0);
        self.at.push(pool.id(held.at).0);
        self.line.push(held.line);
        self.flags.push(flags(held));
        self.through_line.push(if held.through.is_some() { held.through_line } else { 0 });
        self.local.push(maybe(pool, held.local));
        self.name.push(maybe(pool, held.name));
    }

    /// Its string ids read through `to`.
    fn remap(&mut self, to: &[u32]) {
        for column in [&mut self.by, &mut self.at, &mut self.local, &mut self.name] {
            remapped(column, to);
        }
    }

    fn append(&mut self, mut other: Uses) {
        self.by.append(&mut other.by);
        self.at.append(&mut other.at);
        self.line.append(&mut other.line);
        self.flags.append(&mut other.flags);
        self.through_line.append(&mut other.through_line);
        self.local.append(&mut other.local);
        self.name.append(&mut other.name);
    }
}

/// Uses whose strings are pooled apart while runs of packages arrive: the
/// store pools a phase's strings after every row's, so each phase is pooled on
/// its own and joins the store's pool, in the order it met them, at the end.
#[derive(Default)]
struct Phase<'a> {
    pool: Pool<'a>,
    uses: Uses,
}

impl<'a> Phase<'a> {
    /// Its strings joined to `strings`, in the order it met them, and its uses
    /// read by their ids there; the place each of its ids took.
    fn pooled(mut self, strings: &mut Pool<'a>) -> (Uses, Vec<u32>) {
        let to: Vec<u32> = self.pool.values.iter().map(|value| strings.id(value).0).collect();
        self.uses.remap(&to);
        (self.uses, to)
    }
}

fn remapped(column: &mut [u32], to: &[u32]) {
    for id in column.iter_mut().filter(|id| **id != NONE) {
        *id = to[*id as usize];
    }
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

    let mut sorted: Vec<&str> = input.packages.names();
    sorted.extend(exported.iter().map(|named| named.name.as_str()));
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

    // Each run of packages, its rows in `everyEntry` order. A row's strings are
    // pooled as it comes; its uses, the openings' and the openings' own uses in
    // phases of their own, pooled after every row as the store orders them.
    let mut pub_cols: [Vec<u32>; 5] = Default::default(); // name, spec, kind, doc, at
    let (mut used_by_off, mut used_by, mut pub_uses) = (vec![0u32], Vec::new(), Vec::new());
    let mut pub_more: [Vec<u32>; 6] = Default::default(); // declared, line, signature, mentionAt, mentionLine, mentionText
    let (mut sites, mut td, mut opened) = (Phase::default(), Phase::default(), Phase::default());
    let (mut sites_off, mut td_off) = (vec![0u32], vec![0u32]);
    let (mut pkg_name, mut pkg_entry, mut pkg_open_off) = (Vec::new(), Vec::new(), vec![0u32]);
    let (mut open_subpath, mut open_source, mut open_entry_off, mut open_whole_off) = (Vec::new(), Vec::new(), vec![0u32], vec![0u32]);
    let mut found = Terms::default();
    let (mut doc_pairs, mut sig_pairs, mut doc_lower) = (Vec::new(), Vec::new(), Runs::new("\0", 0));
    let mut row = 0u32;
    input.packages.each(&mut |run| {
        let entries: Vec<(&EntryRef<'a>, &'a str)> = run.iter()
            .flat_map(|owner| owner.openings.iter())
            .flat_map(|opening| opening.entries.iter().map(move |entry| (entry, opening.spec)))
            .collect();
        for (at, (entry, spec)) in entries.iter().enumerate() {
            let name = name_of!(entry.name);
            name_pub[name as usize].push(row + at as u32);
            pub_cols[0].push(name);
            pub_cols[1].push(strings.id(spec).0);
            pub_cols[2].push(strings.id(entry.kind).0);
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
            for site in &entry.sites {
                sites.uses.push(&mut sites.pool, site);
            }
            sites_off.push(sites.uses.len());
            for site in &entry.through_default {
                td.uses.push(&mut td.pool, site);
            }
            td_off.push(td.uses.len());
        }
        for owner in run {
            pkg_name.push(opened.pool.id(owner.name).0);
            pkg_entry.push(u8::from(owner.entry));
            for opening in &owner.openings {
                open_subpath.push(opened.pool.id(opening.subpath).0);
                open_source.push(opened.pool.id(opening.source).0);
                open_entry_off.push(open_entry_off[open_entry_off.len() - 1] + opening.entries.len() as u32);
                for site in &opening.whole {
                    opened.uses.push(&mut opened.pool, site);
                }
                open_whole_off.push(opened.uses.len());
            }
            pkg_open_off.push(open_subpath.len() as u32);
        }
        found.add(&mut doc_pairs, &entries, row, |(entry, _)| entry.doc.map(|doc| terms_of(split, doc)).unwrap_or_default());
        found.add(&mut sig_pairs, &entries, row, |(entry, _)| {
            headed(entry.kind).then_some(entry.signature).flatten().map(|signature| terms_of(split, signature)).unwrap_or_default()
        });
        for lowered in batched(&entries, |(entry, _)| entry.doc.unwrap_or("").to_lowercase()) {
            doc_lower.push(&lowered);
        }
        row += entries.len() as u32;
    });

    let (mut uses, _) = sites.pooled(&mut strings);
    let (held, _) = td.pooled(&mut strings);
    td_off.iter_mut().for_each(|off| *off += uses.len());
    uses.append(held);
    let (held, to) = opened.pooled(&mut strings);
    for column in [&mut pkg_name, &mut open_subpath, &mut open_source] {
        remapped(column, &to);
    }
    open_whole_off.iter_mut().for_each(|off| *off += uses.len());
    uses.append(held);
    let sites_end = *sites_off.last().unwrap_or(&0) as usize;

    let all: Vec<&DeepRef> = input.deep.iter().flatten().collect();
    let mut deep: [Vec<u32>; 5] = Default::default(); // specifier, by, at, line, to
    let mut deep_names_off = vec![uses.len()];
    for held in &all {
        deep[0].push(strings.id(held.specifier).0);
        deep[1].push(strings.id(held.by).0);
        deep[2].push(strings.id(held.at).0);
        deep[3].push(held.line);
        deep[4].push(maybe(&mut strings, held.to));
        for name in &held.names {
            uses.push(&mut strings, name);
        }
        deep_names_off.push(uses.len());
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

    // Names, then rows by doc, by export doc, by signature and by export
    // signature, their terms in the one dictionary the runs began.
    let held = [
        found.pairs(&names.values, |name| terms_of(split, name)),
        doc_pairs,
        found.pairs(exported, |named| named.doc.as_deref().map(|doc| terms_of(split, doc)).unwrap_or_default()),
        sig_pairs,
        found.pairs(exported, |named| {
            let signature = named.declaration.as_deref().is_none_or(headed).then_some(named.signature.as_deref()).flatten();
            signature.map(|signature| terms_of(split, signature)).unwrap_or_default()
        }),
    ];
    let (terms, place) = found.sorted();

    let site_files = &uses.at[..sites_end];
    let mut files: Vec<u32> = pub_cols[4].iter().chain(site_files).chain(&exp[1]).copied().collect::<HashSet<u32>>().into_iter().collect();
    files.par_sort_unstable_by(|&a, &b| strings.values[a as usize].as_bytes().cmp(strings.values[b as usize].as_bytes()));

    let (strings_off, strings_blob) = joined(&strings.values, "");
    let (lower_off, lower_blob) = joined(batched(&names.values, |name| name.to_lowercase()), "\0");
    let (doc_off, doc_blob) = doc_lower.done();
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
