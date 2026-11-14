//! The body of the questions' store: every column `openHelpStore` and
//! `helpOf` in `packages/help/src` read, by name.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use crate::help_store::{flags, DeepRef, StoreEntry, StoreRef, UseRef, NONE, USE_KINDS};
use crate::help_search::{headed, joined, postings, terms_of, Pool, SPLIT};
use crate::help_usage::NamedExport;
use crate::order::code_unit;
use crate::segment::{u32s, u8s, Column};

/// What holds one term: names, and rows by their doc or their signature, each ascending.
#[derive(Default)]
struct Held {
    names: Vec<u32>,
    published: Vec<u32>,
    exported: Vec<u32>,
    published_signature: Vec<u32>,
    exported_signature: Vec<u32>,
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
pub(crate) fn body_of(input: &StoreRef, exported: &[NamedExport]) -> Vec<Column> {
    let split = &*SPLIT;
    let (mut strings, mut names) = (Pool::default(), Pool::default());
    let mut by_term: HashMap<String, Held> = HashMap::new();

    // Every entry, in `everyEntry` order, with its opening's specifier.
    let entries: Vec<(&StoreEntry, &str)> = input.packages.iter()
        .flat_map(|owner| owner.openings.iter())
        .flat_map(|opening| opening.entries.iter().map(move |entry| (entry, opening.spec.as_str())))
        .collect();

    let mut sorted: Vec<&str> = entries.iter().map(|(entry, _)| entry.name.as_str()).chain(exported.iter().map(|named| named.name.as_str())).collect();
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
    let mut doc_lower = Vec::with_capacity(rows);
    let doc_terms: Vec<HashSet<String>> =
        entries.par_iter().map(|(entry, _)| entry.doc.as_deref().map(|doc| terms_of(split, doc)).unwrap_or_default()).collect();
    let signature_terms: Vec<HashSet<String>> = entries.par_iter()
        .map(|(entry, _)| headed(&entry.kind).then_some(entry.signature.as_deref()).flatten().map(|signature| terms_of(split, signature)).unwrap_or_default())
        .collect();
    for (row, (entry, spec)) in entries.iter().enumerate() {
        let name = name_of!(entry.name.as_str());
        name_pub[name as usize].push(row as u32);
        pub_cols[0].push(name);
        pub_cols[1].push(strings.id(spec).0);
        pub_cols[2].push(strings.id(&entry.kind).0);
        pub_cols[3].push(maybe(&mut strings, entry.doc.as_deref()));
        pub_cols[4].push(strings.id(&entry.at).0);
        used_by.extend(entry.used_by.iter().map(|by| strings.id(by).0));
        used_by_off.push(used_by.len() as u32);
        pub_uses.push(entry.uses);
        pub_more[0].push(strings.id(&entry.declared).0);
        pub_more[1].push(entry.line);
        pub_more[2].push(maybe(&mut strings, entry.signature.as_deref()));
        pub_more[3].push(maybe(&mut strings, entry.mention.as_ref().map(|held| held.at.as_str())));
        pub_more[4].push(entry.mention.as_ref().map_or(0, |held| held.line));
        pub_more[5].push(maybe(&mut strings, entry.mention.as_ref().map(|held| held.text.as_str())));
        doc_lower.push(entry.doc.as_deref().unwrap_or("").to_lowercase());
        for term in &doc_terms[row] {
            by_term.entry(term.clone()).or_default().published.push(row as u32);
        }
        for term in &signature_terms[row] {
            by_term.entry(term.clone()).or_default().published_signature.push(row as u32);
        }
    }
    let mut sites_off = vec![0u32];
    for (entry, _) in &entries {
        for site in &entry.sites {
            use_of!(&UseRef::from(site));
        }
        sites_off.push(uses.by.len() as u32);
    }
    let mut td_off = vec![uses.by.len() as u32];
    for (entry, _) in &entries {
        for site in &entry.through_default {
            use_of!(&UseRef::from(site));
        }
        td_off.push(uses.by.len() as u32);
    }

    let (mut pkg_name, mut pkg_entry, mut pkg_open_off) = (Vec::new(), Vec::new(), vec![0u32]);
    let (mut open_subpath, mut open_source, mut open_entry_off, mut open_whole_off) = (Vec::new(), Vec::new(), vec![0u32], vec![uses.by.len() as u32]);
    let mut entry_at = 0u32;
    for owner in input.packages {
        pkg_name.push(strings.id(&owner.name).0);
        pkg_entry.push(u8::from(owner.entry));
        for opening in &owner.openings {
            open_subpath.push(strings.id(&opening.subpath).0);
            open_source.push(strings.id(&opening.source).0);
            entry_at += opening.entries.len() as u32;
            open_entry_off.push(entry_at);
            for site in &opening.whole {
                use_of!(&UseRef::from(site));
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
    let (mut exp_kind, mut exp_type, mut exp_doc_lower) = (Vec::with_capacity(count), Vec::with_capacity(count), Vec::with_capacity(count));
    let exp_terms: Vec<HashSet<String>> =
        exported.par_iter().map(|named| named.doc.as_deref().map(|doc| terms_of(split, doc)).unwrap_or_default()).collect();
    let exp_signature_terms: Vec<HashSet<String>> = exported.par_iter()
        .map(|named| named.declaration.as_deref().is_none_or(headed).then_some(named.signature.as_deref()).flatten().map(|signature| terms_of(split, signature)).unwrap_or_default())
        .collect();
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
        exp_doc_lower.push(named.doc.as_deref().unwrap_or("").to_lowercase());
        for term in &exp_terms[row] {
            by_term.entry(term.clone()).or_default().exported.push(row as u32);
        }
        for term in &exp_signature_terms[row] {
            by_term.entry(term.clone()).or_default().exported_signature.push(row as u32);
        }
    }

    let name_terms: Vec<HashSet<String>> = names.values.par_iter().map(|name| terms_of(split, name)).collect();
    for (id, held) in name_terms.into_iter().enumerate() {
        for term in held {
            by_term.entry(term).or_default().names.push(id as u32);
        }
    }
    let mut terms: Vec<&String> = by_term.keys().collect();
    terms.par_sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    let site_files = &uses.at[..*sites_off.last().unwrap_or(&0) as usize];
    let mut files: Vec<u32> = pub_cols[4].iter().chain(site_files).chain(&exp[1]).copied().collect::<HashSet<u32>>().into_iter().collect();
    files.par_sort_unstable_by(|&a, &b| strings.values[a as usize].as_bytes().cmp(strings.values[b as usize].as_bytes()));

    let (strings_off, strings_blob) = joined(&strings.values, "");
    let lowered: Vec<String> = names.values.par_iter().map(|name| name.to_lowercase()).collect();
    let (lower_off, lower_blob) = joined(&lowered, "\0");
    let (doc_off, doc_blob) = joined(&doc_lower, "\0");
    let (exp_doc_off, exp_doc_blob) = joined(&exp_doc_lower, "\0");
    let (terms_off, terms_blob) = joined(&terms, "");
    let lists = |lists: &[Vec<u32>]| postings(&lists.iter().map(Vec::as_slice).collect::<Vec<_>>());
    let (names_pub_off, names_pub) = lists(&name_pub);
    let (names_exp_off, names_exp) = lists(&name_exp);
    let held = |field: fn(&Held) -> &[u32]| postings(&terms.iter().map(|term| field(&by_term[*term])).collect::<Vec<_>>());
    let (term_name_off, term_name) = held(|held| &held.names);
    let (term_pub_off, term_pub) = held(|held| &held.published);
    let (term_exp_off, term_exp) = held(|held| &held.exported);
    let (term_pub_sig_off, term_pub_sig) = held(|held| &held.published_signature);
    let (term_exp_sig_off, term_exp_sig) = held(|held| &held.exported_signature);

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
