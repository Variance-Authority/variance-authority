//! The body of the questions' store: every section `SECTIONS` in
//! `packages/help/src/search-index.ts` names, in that order.

// compass: variance-authority.report.agent-surface

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use crate::help_store::{align, flags, DeepRef, StoreEntry, StoreRef, UseRef, NONE, USE_KINDS};
use crate::help_search::{headed, joined, postings, terms_of, Pool, Section, SPLIT};
use crate::help_usage::NamedExport;
use crate::order::code_unit;

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

pub(crate) struct Body(Vec<Section>);

impl Body {
    /// The sections and where each starts in the body, 4-aligned.
    pub(crate) fn laid_out(&self) -> (Vec<(u32, u32)>, Vec<Cow<'_, [u8]>>) {
        let bodies: Vec<Cow<[u8]>> = self.0.par_iter().map(Section::bytes).collect();
        let mut table = Vec::with_capacity(bodies.len());
        let mut size = 0usize;
        for body in &bodies {
            table.push((size as u32, body.len() as u32));
            size = align(size + body.len());
        }
        (table, bodies)
    }

    pub(crate) fn of(input: &StoreRef, exported: &[NamedExport]) -> Body {
        let split = &*SPLIT;
        let (mut strings, mut names) = (Pool::default(), Pool::default());
        let (mut name_string, mut name_pub, mut name_exp): (Vec<u32>, Vec<Vec<u32>>, Vec<Vec<u32>>) = Default::default();
        let mut by_term: HashMap<String, Held> = HashMap::new();

        macro_rules! name_of {
            ($name:expr) => {{
                let (id, new) = names.id($name);
                if new {
                    name_string.push(strings.id($name).0);
                    name_pub.push(Vec::new());
                    name_exp.push(Vec::new());
                }
                id
            }};
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

        // Every entry, in `everyEntry` order, with its opening's specifier.
        let entries: Vec<(&StoreEntry, &str)> = input.packages.iter()
            .flat_map(|owner| owner.openings.iter())
            .flat_map(|opening| opening.entries.iter().map(move |entry| (entry, opening.spec.as_str())))
            .collect();
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

        let mut order: Vec<u32> = (0..names.values.len() as u32).collect();
        order.par_sort_unstable_by(|&a, &b| code_unit(names.values[a as usize], names.values[b as usize]));
        let mut rank = vec![0u32; order.len()];
        for (at, &id) in order.iter().enumerate() {
            rank[id as usize] = at as u32;
        }

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

        use Section::{Bytes, Words};
        let [pub_name, pub_spec, pub_kind, pub_doc, pub_at] = pub_cols;
        let [pub_declared, pub_line, pub_signature, mention_at, mention_line, mention_text] = pub_more;
        let [exp_name, exp_at, exp_by, exp_line, exp_doc, exp_bound, exp_declaration, exp_bound_line, exp_signature] = exp;
        let [deep_specifier, deep_by, deep_at, deep_line, deep_to] = deep;
        Body(vec![
            Words(strings_off), Bytes(strings_blob), Words(files),
            Words(name_string), Words(rank), Words(lower_off), Bytes(lower_blob),
            Words(names_pub_off), Words(names_pub), Words(names_exp_off), Words(names_exp),
            Words(pub_name), Words(pub_spec), Words(pub_kind), Words(pub_doc), Words(pub_at),
            Words(used_by_off), Words(used_by), Words(pub_uses), Words(sites_off), Words(td_off),
            Words(doc_off), Bytes(doc_blob),
            Words(pub_declared), Words(pub_line), Words(pub_signature), Words(mention_at), Words(mention_line), Words(mention_text),
            Words(exp_name), Words(exp_at), Words(exp_by), Words(exp_line), Bytes(exp_kind), Words(exp_doc),
            Words(exp_doc_off), Bytes(exp_doc_blob),
            Bytes(exp_type), Words(exp_bound), Words(exp_declaration), Words(exp_bound_line), Words(exp_signature),
            Words(uses.by), Words(uses.at), Words(uses.line), Bytes(uses.flags), Words(uses.through_line), Words(uses.local), Words(uses.name),
            Words(pkg_name), Bytes(pkg_entry), Words(pkg_open_off),
            Words(open_subpath), Words(open_source), Words(open_entry_off), Words(open_whole_off),
            Words(deep_specifier), Words(deep_by), Words(deep_at), Words(deep_line), Words(deep_to), Words(deep_names_off), Words(groups),
            Words(unreadable),
            Words(terms_off), Bytes(terms_blob),
            Words(term_name_off), Words(term_name), Words(term_pub_off), Words(term_pub),
            Words(term_exp_off), Words(term_exp), Words(term_pub_sig_off), Words(term_pub_sig),
            Words(term_exp_sig_off), Words(term_exp_sig),
        ])
    }
}
