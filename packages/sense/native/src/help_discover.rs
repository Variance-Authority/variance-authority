//! Cross the requested source sets before rendering a page of the result.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use crate::help_grep::match_lines;
use crate::help_grep_answer::{refusal, seeds};
use crate::help_page::Page;
use crate::help_names_filter::{names_filter, ImportAsked, NameHit};
use crate::help_usage::{importers, Asked};
use crate::index_chain::OpenedChain;
use crate::order::code_unit;
use crate::source_query::{SourceTree, SourceWalk};
use crate::text_cut::blank;

#[path = "help_discover_render.rs"]
mod render;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Set {
    From,
    To,
    Imports,
    Declares,
    Path,
}

pub(super) struct Request<'a> {
    sets: BTreeMap<(bool, Set), Vec<&'a str>>,
    text: Option<&'a str>,
    page: Page,
}

impl<'a> Request<'a> {
    pub(super) fn parse(args: &[&'a str]) -> Option<Self> {
        let mut page = Page { limit: 50, offset: 0 };
        let mut seen = std::collections::HashSet::new();
        let mut sets = BTreeMap::<_, Vec<_>>::new();
        let mut text = None;
        let mut argv = args.iter().copied();
        while let Some(word) = argv.next() {
            let (flag, value) = match word.split_once('=') {
                Some(pair) => pair,
                None => (word, argv.next().filter(|value| !value.starts_with("--"))?),
            };
            let flag = flag.strip_prefix("--")?;
            if !seen.insert(flag) {
                return None;
            }
            match flag {
                "text" => {
                    text = (!value.trim_matches(blank).is_empty()).then_some(value);
                    continue;
                }
                "limit" => {
                    page.limit = number(value, false)?;
                    continue;
                }
                "offset" => {
                    page.offset = number(value, true)?;
                    continue;
                }
                _ => {}
            }
            let (out, flag) = flag.strip_prefix("except-").map_or((false, flag), |flag| (true, flag));
            let kind = match flag {
                "from" => Set::From,
                "to" => Set::To,
                "imports" => Set::Imports,
                "declares" => Set::Declares,
                "path" => Set::Path,
                _ => return None,
            };
            let words = sets.entry((out, kind)).or_default();
            if matches!(kind, Set::From | Set::To | Set::Imports) {
                for term in value.split(',').map(|term| term.trim_matches(blank)).filter(|term| !term.is_empty()) {
                    if !words.contains(&term) {
                        words.push(term);
                    }
                }
            } else if !value.trim_matches(blank).is_empty() {
                words.push(value);
            }
        }
        Some(Self { sets, text, page })
    }
}

fn number(value: &str, zero: bool) -> Option<usize> {
    if value == "0" && zero {
        return Some(0);
    }
    if !value.as_bytes().first().is_some_and(|byte| matches!(byte, b'1'..=b'9')) {
        return None;
    }
    value.parse().ok()
}

type Evidence = HashMap<String, Vec<(u32, String)>>;

struct Operand {
    header: String,
    note: Option<String>,
    files: HashMap<String, u32>,
    evidence: Evidence,
    reach: Option<Reach>,
}

struct Reach {
    said: String,
    backward: Option<SourceWalk>,
    named: bool,
}

impl Reach {
    fn chain(&self, file: &str, hops: u32, evidence: &Evidence) -> Option<Vec<String>> {
        if hops <= 1 {
            return None;
        }
        let mut trail = self.backward.as_ref()?.chain(file.to_owned());
        let tail = self.named.then(|| trail.pop()).flatten().and_then(|seed| {
            let (line, text) = evidence.get(&seed.file)?.first()?;
            Some(format!("{}:{line} {text}", seed.file))
        });
        Some(
            trail
                .into_iter()
                .map(|step| {
                    let kind = match step.kind.as_deref() {
                        None | Some("imports") => return step.file,
                        Some("type") => "type import",
                        Some("reexports") => "export … from",
                        Some("dynamic") => "import()",
                        Some("asset") => "asset import",
                        Some(kind) => kind,
                    };
                    format!("{} ({kind})", step.file)
                })
                .chain(tail)
                .collect(),
        )
    }
}

/// The same graph walks and index readers as the addon, kept in this process.
pub(super) fn answer(
    root: &str,
    index: &Path,
    tree: &SourceTree,
    request: Request<'_>,
) -> Option<Result<String, String>> {
    let sets: Vec<_> = request
        .sets
        .iter()
        .flat_map(|(&(out, kind), words)| words.iter().map(move |&word| (out, kind, word)))
        .collect();
    let imports: Vec<_> = sets
        .iter()
        .filter(|&&(_, kind, word)| kind == Set::Imports && file_name(tree, word).is_none())
        .map(|&(_, _, word)| {
            let (spec, name) = split_name(word);
            ImportAsked { spec: spec.to_owned(), name: name.map(str::to_owned) }
        })
        .collect();
    let declares: Vec<_> =
        sets.iter().filter(|&&(_, kind, _)| kind == Set::Declares).map(|&(_, _, word)| word.to_owned()).collect();
    let needs_index = !imports.is_empty()
        || !declares.is_empty()
        || sets
            .iter()
            .any(|&(_, kind, word)| matches!(kind, Set::To | Set::Imports) && file_name(tree, word).is_some());
    let chain = if needs_index { Some(OpenedChain::read(index.to_str()?).ok()??) } else { None };
    let layers = chain.as_ref().map_or(&[][..], OpenedChain::layers);
    let names = (!imports.is_empty() || !declares.is_empty()).then(|| {
        let readable = crate::help_members::indexed_extensions(layers)
            .into_iter()
            .filter(|extension| crate::read_any::language_of(extension).is_some())
            .collect::<Vec<_>>();
        names_filter(layers, &imports, &declares, &readable)
    });
    let unread = names.as_ref().map_or(0, |read| read.unread.iter().filter(|file| tree.has((*file).clone())).count());
    let (imports, declarations) = names.map(|read| (read.imports, read.declares)).unwrap_or_default();
    let mut imports = imports.into_iter();
    let mut declarations = declarations.into_iter();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for (out, kind, term) in sets {
        let named = file_name(tree, term).filter(|_| matches!(kind, Set::To | Set::Imports));
        let operand = match kind {
            Set::From | Set::To => match reach(
                tree,
                root,
                term,
                kind == Set::To,
                out,
                named.map(|(file, name)| {
                    let (evidence, through) = import_sites(root, layers, file, name);
                    (file, name, evidence, through)
                }),
            ) {
                Ok(operand) => operand,
                Err(error) => return Some(Err(error)),
            },
            Set::Imports => {
                let (spec, name) = split_name(term);
                if name == Some("") {
                    return None;
                }
                let what = name
                    .map_or_else(|| format!("importing `{spec}`"), |name| format!("importing `{name}` from `{spec}`"));
                if let Some((file, name)) = named {
                    let (evidence, through) = import_sites(root, layers, file, name);
                    named_set(format!("{what}{through}"), evidence, 0)
                } else {
                    named_set(what, named_lines(tree, imports.next()?, import_text), unread)
                }
            }
            Set::Declares => {
                let found = declarations.next()?;
                if let Some(error) = found.refused {
                    return Some(Err(format!(
                        "`declares` is not a regular expression the source index reads: {error}."
                    )));
                }
                named_set(
                    format!("declaring a name matching /{term}/i"),
                    named_lines(tree, found.hits, |hit| format!("declares {}", hit.name.as_deref().unwrap_or("null"))),
                    unread,
                )
            }
            Set::Path => {
                let regex =
                    regress::Regex::from_unicode(term.encode_utf16().map(u32::from), regress::Flags::default()).ok()?;
                let mut utf16 = Vec::new();
                let files: HashMap<_, _> = tree
                    .workspace_paths()
                    .filter(|file| {
                        if file.is_ascii() {
                            return regex.find(file).is_some();
                        }
                        utf16.clear();
                        utf16.extend(file.encode_utf16());
                        regex.find_from_ucs2(&utf16, 0).next().is_some()
                    })
                    .map(|file| (file.to_owned(), u32::MAX))
                    .collect();
                Operand {
                    header: format!("{} with a path matching /{term}/", counted(files.len())),
                    note: None,
                    files,
                    evidence: Evidence::new(),
                    reach: None,
                }
            }
        };
        if out {
            removed.push(operand);
        } else {
            kept.push(operand);
        }
    }
    let first = kept.iter().min_by_key(|operand| operand.files.len())?;
    let mut files: Vec<_> = first
        .files
        .keys()
        .filter(|file| {
            kept.iter().all(|set| set.files.contains_key(*file))
                && removed.iter().all(|set| !set.files.contains_key(*file))
        })
        .map(|file| (kept.iter().map(|set| set.files[file]).min().unwrap_or(u32::MAX), file.as_str()))
        .collect();
    files.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| code_unit(a.1, b.1)));
    let mut files: Vec<_> = files.into_iter().map(|(_, file)| file).collect();
    let mut headers: Vec<_> = kept
        .iter()
        .map(|set| set.header.clone())
        .chain(removed.iter().map(|set| format!("{}, taken out", set.header)))
        .collect();
    let mut notes = Vec::new();
    for note in kept.iter().chain(&removed).filter_map(|set| set.note.as_ref()) {
        if !notes.contains(note) {
            notes.push(note.clone());
        }
    }
    let mut text = Evidence::new();
    if let Some(pattern) = request.text.filter(|_| !files.is_empty()) {
        let paths: Vec<_> = files.iter().map(|file| (*file).to_owned()).collect();
        let found = match match_lines(Path::new(root), pattern, &paths) {
            Ok(found) => found,
            Err(error) => return Some(Err(error)),
        };
        for ((file, line), value) in found.file.into_iter().zip(found.line).zip(found.text) {
            text.entry(files[file as usize].to_owned()).or_default().push((line, value));
        }
        let among = if files.len() == 1 { "one file".into() } else { counted(files.len()) };
        headers.push(format!("`{pattern}` matches a line in {} of the {among} the other sets kept", text.len()));
        if let Some(first) = found.errors.first() {
            let noun = if found.errors.len() == 1 { "error" } else { "errors" };
            notes.push(format!("ripgrep reported {} {noun}; the first: {first}", found.errors.len()));
        }
        files.retain(|file| text.contains_key(*file));
    }
    Some(Ok(render::answer(&kept, &headers, &notes, &files, &text, request.page)))
}

fn split_name(written: &str) -> (&str, Option<&str>) {
    written
        .rsplit_once('#')
        .filter(|(spec, _)| !spec.is_empty())
        .map_or((written, None), |(spec, name)| (spec, Some(name)))
}

fn file_name<'a>(tree: &SourceTree, written: &'a str) -> Option<(&'a str, &'a str)> {
    let (spec, name) = split_name(written);
    name.filter(|name| !name.is_empty() && tree.has(spec.to_owned())).map(|name| (spec, name))
}

fn import_sites(root: &str, layers: &[crate::compact::Layer], file: &str, name: &str) -> (Evidence, String) {
    let read = importers(root, layers, &[vec![Asked { file: file.to_owned(), name: name.to_owned() }]]);
    let mut evidence = Evidence::new();
    let mut through = String::new();
    if let Some(group) = read.groups.into_iter().next() {
        let count = group.through.len();
        if count > 0 {
            let verb = if count == 1 { "passes" } else { "pass" };
            through = format!(", through {} that {verb} it on", counted(count));
        }
        for site in group.uses {
            let taking = match site.through.as_deref() {
                None => "",
                Some("dynamic") => " through import()",
                Some(_) => " through a namespace",
            };
            let off = if site.through_default { ", through `default`: may read it" } else { "" };
            let whole = if site.whole { ", passed on whole: may read it" } else { "" };
            evidence
                .entry(site.at)
                .or_default()
                .push((site.line, format!("imports {} from {}{taking}{off}{whole}", site.name, site.key)));
        }
    }
    (evidence, through)
}

fn reach(
    tree: &SourceTree,
    root: &str,
    term: &str,
    backward: bool,
    out: bool,
    named: Option<(&str, &str, Evidence, String)>,
) -> Result<Operand, String> {
    let (seeds, subject, evidence, seed) = if let Some((file, name, evidence, through)) = named {
        (evidence.keys().cloned().collect(), format!("`{name}` from `{file}`{through}"), evidence, Some(file))
    } else {
        let terms = [term.to_owned()];
        let (found, unmatched) = seeds(tree, root, &terms);
        if !unmatched.is_empty() {
            return Err(format!("`discover` ran nothing: {}. Say a real path from the root — `src/a/File.ts` is that file, `src/a/*` its folder's own files, `src/a/` everything under it.", refusal(root, &unmatched)));
        }
        (found.into_iter().collect(), format!("`{term}`"), Evidence::new(), None)
    };
    let walk = tree.walk(seeds, backward);
    let mut files: HashMap<_, _> = walk
        .reached_with_depth()
        .map(|(file, distance)| (file.to_owned(), distance + u32::from(seed.is_some())))
        .collect();
    if let Some(seed) = seed {
        files.insert(seed.to_owned(), 0);
    }
    let direction = if backward { "reaching" } else { "reached from" };
    let said = format!("{direction} {subject}");
    let subject = if out { format!("{said}, which is taken out") } else { said.clone() };
    let unknown = tree.unknown_files();
    let note = if backward {
        let unseen: Vec<_> = unknown.iter().filter(|file| !files.contains_key(*file)).collect();
        (!unseen.is_empty()).then(|| {
            let count = unseen.len();
            let noun = if count == 1 { "file imports" } else { "files import" };
            let first = unseen.iter().take(5).map(|file| file.as_str()).collect::<Vec<_>>().join(", ");
            let rest = if count > 5 { format!(" and {} more", count - 5) } else { String::new() };
            format!("{count} other {noun} something the scan could not resolve, and may be {subject}: {first}{rest}")
        })
    } else {
        let count = unknown.iter().filter(|file| files.contains_key(*file)).count();
        (count > 0).then(|| format!("{} {subject} import something the scan could not resolve", counted(count)))
    };
    Ok(Operand {
        header: format!("{} {said}", counted(files.len())),
        note,
        files,
        evidence,
        reach: Some(Reach { said, backward: backward.then_some(walk), named: seed.is_some() }),
    })
}

fn named_set(what: String, evidence: Evidence, unread: usize) -> Operand {
    let files = evidence.keys().map(|file| (file.clone(), u32::MAX)).collect();
    Operand {
        header: format!("{} {what}", counted(evidence.len())),
        note: (unread > 0).then(|| format!("the names of {} were not read", counted(unread))),
        files,
        evidence,
        reach: None,
    }
}

fn named_lines(tree: &SourceTree, hits: Vec<NameHit>, render: impl Fn(&NameHit) -> String) -> Evidence {
    let mut lines = Evidence::new();
    for hit in hits {
        if tree.has(hit.file.clone()) {
            let text = render(&hit);
            lines.entry(hit.file).or_default().push((hit.line, text));
        }
    }
    lines
}

fn import_text(hit: &NameHit) -> String {
    let name = hit.name.as_ref().map_or_else(String::new, |name| format!("{name} "));
    let from = hit.from.as_deref().unwrap_or("null");
    let as_ = hit.local.as_ref().map_or_else(String::new, |local| format!(" as {local}"));
    let through = hit.through.as_ref().map_or_else(String::new, |through| format!(" through {through}"));
    format!("imports {name}from {from}{as_}{through}")
}

fn counted(count: usize) -> String {
    format!("{count} {}", if count == 1 { "file" } else { "files" })
}
