//! Render search from the published columns and the native declaration index.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::compact::Layer;
use crate::dependency_lexicon::{describing::code_words, query::search_dependencies};
use crate::help_aliases::aliases;
use crate::help_declared::{declared, DeclaredName, Matching};
use crate::help_grep_answer::{area_line, Scope};
use crate::help_members::indexed_extensions;
use crate::help_origin::declaration_exported;
use crate::help_search_cases;
use crate::help_search_dependencies;
use crate::help_search_loose::{self, Loose};
use crate::help_search_matches::{exactness, matching, opening, postings};
use crate::help_search_near::{self, IndexedRow, Kind, Row};
use crate::help_search_rows::{compare_exported, compare_published, count_published, exported_page, export_hit, published_hit, published_line, ExportHit};
use crate::help_surface::{CLI, Value, typed};
use crate::help_symbol_answer::{declaration_kind_order, unread_line};
use crate::help_symbol_rows::Rows;
use crate::index_chain::OpenedChain;
use crate::read_any::{language_of, Language};
use crate::text_cut::blank;

const PUBLISHED_CAP: usize = 20;
const OTHER_CAP: usize = 10;

pub(crate) fn search(root: &str, index: &Path, file: &mut File, query: &str, limit: Option<usize>, scope: Option<&Scope>) -> Option<String> {
    let lowered = query.to_lowercase();
    let words = code_words(&lowered);
    let multiword = words.values().collect::<HashSet<_>>().len() >= 2;
    let directory = index.parent()?;
    let dependencies = search_dependencies(directory, &lowered, scope.map(|scope| scope.from.iter().chain(&scope.to).cloned().collect()), u32::try_from(limit.unwrap_or(PUBLISHED_CAP)).ok()?)?;
    let installed = dependencies.as_ref().is_some_and(|matches| matches.total > 0);
    let mut rows = Rows::read(file)?;
    rows.read_search(file)?;
    let found = matching(&rows, query, &lowered)?;
    if multiword || scope.is_some() || !found.published.is_empty() || found.exported.is_empty() { rows.read_entries(file)?; }
    rows.read_paths(file)?;

    let chain = OpenedChain::read(index.to_str()?).ok()??;
    let layers = chain.layers();
    let distance = scope.map(|scope| scope.files.iter().map(|(at, hops)| (at.as_str(), *hops)).collect::<HashMap<_, _>>());
    let files = scope.map(|scope| scope.files.iter().map(|(at, _)| at.clone()).collect::<Vec<_>>());
    let cap = limit.unwrap_or(OTHER_CAP);
    let cases = help_search_cases::cases(root, directory, &lowered, &words, files.as_deref(), cap)?;
    let admits = |at: &str| distance.as_ref().is_none_or(|distance| distance.contains_key(at));
    let read = declared(root, layers, query, Matching::Containing, files.as_deref());
    let nearby = aliases(root, layers, query);
    let mut imports = Vec::new();
    for alias in &nearby {
        if !admits(&alias.at) || alias.to.as_ref().and_then(|at| declaration_exported(layers, at, &alias.imported)).is_some_and(|held| held.name == query) { continue }
        let ty = if alias.r#type { " (type only)" } else { "" };
        imports.push(format!("{}:{} imports `{}` as `{query}` from '{}'{}", alias.at, alias.line, alias.imported, alias.specifier, ty));
    }
    let mut answer = Vec::new();
    if let Some(scope) = scope { answer.extend([area_line(scope), String::new()]); }
    let place = if scope.is_some() { "in that area" } else { "somewhere in the repository" };
    let mut next = None;
    let mut suppressed = BTreeSet::new();
    let mut already = found.named;
    let mut published = Vec::new();
    for (row, field) in found.published {
        let hit = published_hit(&rows, row, field, distance.as_ref())?;
        if hit.in_area.as_ref().is_some_and(|area| area.imports == 0) { continue }
        suppressed.insert(hit.name);
        already.insert(hit.name);
        published.push(hit);
    }
    let published_total = published.len();
    if published_total != 0 {
        let cap = limit.unwrap_or(PUBLISHED_CAP);
        keep(&mut published, cap, compare_published);
        count_published(root, layers, &rows, &mut published)?;
        published.sort_by(compare_published);
        answer.push(format!("{} for `{lowered}`", plural(published_total, "published match", "published matches")));
        answer.push(String::new());
        for hit in &published {
            let name = rows.string("names.name", hit.name)?;
            answer.push(published_line(hit, name, &words));
            next.get_or_insert_with(|| symbol(name, hit.specifier));
        }
        cut(&mut answer, published_total, published.len());
    }

    let mut groups = BTreeMap::<usize, Vec<ExportHit>>::new();
    for (row, field) in found.exported {
        let name = rows.number("exp.name", row)? as usize;
        if suppressed.contains(&name) { continue }
        let at = rows.string("exp.at", row)?;
        if !admits(at) { continue }
        if field >= 3 { already.insert(name); }
        groups.entry(name).or_default().push(export_hit(&rows, row, field)?);
    }
    let mut exported = Vec::new();
    for (name, hits) in groups {
        let count = if scope.is_none() { rows.range("names.expOff", name)?.len() } else {
            postings(&rows, "names.expOff", "names.exp", name)?.into_iter().filter(|&row| rows.string("exp.at", row).is_some_and(admits)).count()
        };
        let picked = hits.into_iter().min_by(compare_exported)?;
        exported.push((name, count, picked));
    }
    let exported_total = exported.len();
    if exported_total != 0 {
        if published_total == 0 {
            answer.push(format!("{} for `{lowered}` (not published):", plural(exported_total, "exported match", "exported matches")));
        } else {
            answer.extend([String::new(), format!("{} more {} exported {place} without being published:", exported_total, if exported_total == 1 { "name is" } else { "names are" })]);
        }
        answer.push(String::new());
        keep(&mut exported, cap, |a, b| a.2.field.cmp(&b.2.field).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0)));
        for (line, at) in exported_page(root, layers, &rows, exported, admits, &words)? {
            answer.push(line);
            next.get_or_insert_with(|| orient(&at));
        }
        cut(&mut answer, exported_total, exported_total.min(cap));
    }

    let has_exports = published_total != 0 || exported_total != 0;
    let (top, held) = declaration_lists(&read.names, query, &lowered, has_exports || installed);
    let own = has_exports || !top.is_empty() || !held.is_empty() || !imports.is_empty() || cases.total != 0;
    let direct = installed || has_exports || !top.is_empty() || held.iter().any(|(rank, _)| *rank < 2) || !imports.is_empty();
    let described = if multiword || !direct {
        let shown = if direct {
            top.iter().take(cap).chain(&held).map(|(_, held)| (held.at.as_str(), held.line, held.name.as_str())).collect()
        } else { HashSet::new() };
        let near_cap = limit.unwrap_or(if direct { 5 } else { OTHER_CAP });
        help_search_near::described(root, &rows, layers, &lowered, &words, files.as_deref(), &already, &shown, near_cap, |a, b| indexed_order(&rows, distance.as_ref(), a, b))?
    } else { help_search_near::Described::default() };
    let loose = if direct { Loose::default() } else {
        help_search_loose::matches(root, &rows, layers, &lowered, files.as_deref(), &already, &described)?
    };
    let loose_total = loose.published.len() + loose.exported.len() + loose.private.len();
    if !own && !installed {
        let place = if scope.is_some() { "in reach of that start point" } else { "in this repository" };
        let alternatives = described.total > 0 || loose_total > 0;
        let next = match (scope.is_some(), alternatives) {
            (false, false) => ". `packages` lists every entrypoint; `entrypoint` lists what one opens.",
            (false, true) => ". The nearest follow.",
            (true, false) => ". That is a fact about the area, not about the word — ask again without `from`/`to` to search the whole workspace.",
            (true, true) => " — ask again without `from`/`to` to search the whole workspace. The nearest in reach follow.",
        };
        answer.push(format!("No export, top-level declaration or member of a class, an interface or a type {place}, nor the doc of one, nor a function inside a function, writes `{lowered}`{next}"));
    }
    if !top.is_empty() {
        let count = top.len();
        section(&mut answer, format!("{count} more {} declared {place} without being exported:", if count == 1 { "name is" } else { "names are" }),
            count, top.into_iter().take(cap).map(|(_, held)| {
                next.get_or_insert_with(|| orient(&held.at));
                format!("{} [{}] — {} · {}:{}{}", held.name, held.kind, owner(held), held.at, held.line, summary(held.doc.as_deref(), &words))
            }));
    }
    if let Some(unread) = unread_line(&read.unread) { answer.extend([String::new(), unread]); }
    if let Some(stop) = member_stop(layers, files.as_deref()) { answer.extend([String::new(), stop]); }
    if !held.is_empty() {
        let count = held.len();
        section(&mut answer, format!("{count} {} held by a container or a function {place}:", if count == 1 { "name is" } else { "names are" }),
            count, held.into_iter().take(cap).map(|(_, held)| {
                next.get_or_insert_with(|| orient(&held.at));
                held_line(held)
            }));
    }
    let next_case = cases.shown.first().map(|(at, _)| orient(at));
    if cases.total != 0 {
        let head = plural(cases.total, "recorded test case holds", "recorded test cases hold");
        section(&mut answer, format!("{head} every word, as the last run wrote it:"), cases.total,
            cases.shown.iter().map(|(file, name)| format!("{name} [test] — {file}")));
    }
    let own = own || described.total > 0 || loose_total > 0;
    if !own {
        let mut unread = cases.unread_lines().peekable();
        if unread.peek().is_some() { answer.push(String::new()); }
        answer.extend(unread);
    }
    if !imports.is_empty() {
        let count = imports.len();
        if next.is_none() {
            let at = &nearby.iter().find(|alias| imports[0].starts_with(&format!("{}:{} ", alias.at, alias.line)))?.at;
            next = Some(orient(at));
        }
        section(&mut answer, format!("{count} {} it as a local name:", if count == 1 { "import binds" } else { "imports bind" }), count, imports.into_iter().take(cap));
    }
    if described.total > 0 {
        let total = described.total;
        let mut displayed = Vec::new();
        let mut after = None;
        for hit in described.shown {
            let (line, suggestion) = described_line(root, layers, &rows, distance.as_ref(), hit.row, &words)?;
            after.get_or_insert(suggestion);
            displayed.push(format!("{line} [holds: {}]", hit.words.join(", ")));
        }
        section(&mut answer, format!("Near matches, not exact: {total} {} most of `{lowered}`:", if total == 1 { "holds" } else { "hold" }), total, displayed.into_iter());
        next = next.or(after);
    }
    if loose_total > 0 {
        let displayed = loose_page(root, layers, &rows, distance.as_ref(), loose, cap, &words)?;
        next = next.or_else(|| displayed.first().map(|(_, next)| next.clone()));
        section(&mut answer, format!("{loose_total} more {} loosely, the words apart or a character off:", if loose_total == 1 { "name matches" } else { "names match" }), loose_total, displayed.into_iter().map(|(line, _)| line));
    }
    help_search_dependencies::lines(&mut answer, query, &lowered, scope, limit, dependencies.as_ref(), own);
    if let Some(next) = next.or(next_case) { answer.extend([String::new(), format!("Next: `{next}`")]); }
    Some(answer.join("\n"))
}

/// The question that reads `name` of `package` next.
fn symbol(name: &str, package: &str) -> String {
    typed(CLI, "symbol", &[("name", Value::Text(name)), ("package", Value::Text(package))])
}

/// The question that reads the file at `at` next.
fn orient(at: &str) -> String {
    typed(CLI, "orient", &[("files", Value::List(&[at]))])
}

fn keep<T>(rows: &mut Vec<T>, cap: usize, before: impl Fn(&T, &T) -> Ordering) {
    if rows.len() > cap {
        rows.select_nth_unstable_by(cap, &before);
        rows.truncate(cap);
    }
    rows.sort_by(before);
}

fn declaration_lists<'a>(names: &'a [DeclaredName], query: &str, lowered: &str, direct: bool) -> (Vec<(u8, &'a DeclaredName)>, Vec<(u8, &'a DeclaredName)>) {
    let mut matches: Vec<_> = names.iter().filter(|held| held.name != "default" || held.on.is_some()).map(|held| {
        let name = held.on.as_ref().map_or_else(|| held.name.clone(), |on| format!("{on}.{}", held.name));
        let rank = exactness(&held.name, query, lowered).or_else(|| exactness(&name, query, lowered))
            .unwrap_or_else(|| if name.to_lowercase().contains(lowered) { 2 } else { 3 });
        (rank, held)
    }).collect();
    matches.sort_by_key(|(rank, held)| (*rank, declaration_kind_order(held)));
    let (top, mut held): (Vec<_>, Vec<_>) = matches.into_iter().partition(|(_, held)| held.on.is_none() && held.holder_line.is_none());
    if direct || !top.is_empty() { held.retain(|(rank, _)| *rank < 2); }
    (top, held)
}

fn owner(held: &DeclaredName) -> &str {
    if held.by.is_empty() { "the repository" } else { &held.by }
}

fn held_line(held: &DeclaredName) -> String {
    let name = &held.name;
    let kind = &held.kind;
    let subject = match held.on.as_deref() {
        Some(on @ ("a type literal" | "a class")) => format!("{name} [{kind}] on {on}"),
        Some(on) => format!("{on}.{name} [{kind}]"),
        None => {
            let who = held.holder.as_ref().map_or_else(|| format!("the function written at {}:{}", held.at, held.holder_line.unwrap_or(0)), |name| format!("`{name}`"));
            format!("{name} [{kind}] inside {who}")
        }
    };
    format!("{subject} — {} · {}:{}", owner(held), held.at, held.line)
}

fn member_stop(layers: &[Layer], files: Option<&[String]>) -> Option<String> {
    let extensions;
    let sources = if let Some(files) = files { files } else { extensions = indexed_extensions(layers); &extensions };
    let mut languages = [(Language::Python, "Python"), (Language::Rust, "Rust"), (Language::Java, "Java"), (Language::Kotlin, "Kotlin"), (Language::Swift, "Swift")]
        .into_iter().filter(|(language, _)| sources.iter().any(|file| language_of(file) == Some(*language)))
        .map(|(_, name)| name).collect::<Vec<_>>();
    let last = languages.pop()?;
    let named = if languages.is_empty() { last.to_owned() } else { format!("{} and {last}", languages.join(", ")) };
    Some(format!("Members are read from JavaScript and TypeScript files only, and this workspace's {named} files were not read for them: a member there is for their language server's workspace symbols to find."))
}

pub(crate) fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

pub(crate) fn section(lines: &mut Vec<String>, heading: String, total: usize, rows: impl ExactSizeIterator<Item = String>) {
    let shown = rows.len();
    lines.extend([String::new(), heading, String::new()]);
    lines.extend(rows);
    cut(lines, total, shown);
}

fn cut(lines: &mut Vec<String>, count: usize, shown: usize) {
    if count > shown { lines.extend([String::new(), format!("{} more not shown; a higher `--limit` shows them.", count - shown)]); }
}

pub(crate) fn summary(doc: Option<&str>, words: &BTreeMap<String, String>) -> String {
    doc.map(|doc| format!(" — {}", sentence(doc, words))).unwrap_or_default()
}

static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?ms)^[ \t]*```.*?^[ \t]*```[ \t]*$").expect("a fixed code block"));
static WRAPPED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]*\n[ \t]*").expect("a fixed line break"));

pub(crate) fn sentence(doc: &str, words: &BTreeMap<String, String>) -> String {
    let prose = CODE.replace_all(doc, "");
    let mut best = (0, String::new());
    for paragraph in prose.split("\n\n").flat_map(|paragraph| paragraph.split("\n@")) {
        let text = paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut from = 0;
        let bytes = text.as_bytes();
        for at in 1..=bytes.len() {
            let boundary = at == bytes.len() || (bytes[at] == b' ' && matches!(bytes[at - 1], b'.' | b'!' | b'?') &&
                bytes.get(at + 1).is_some_and(|next| next.is_ascii_uppercase() || b"`[(".contains(next)));
            if !boundary { continue }
            let sentence = &text[from..at];
            let held = code_words(sentence).keys().filter(|stem| words.contains_key(*stem)).count();
            if held > best.0 { best = (held, sentence.to_owned()); }
            from = at + 1;
        }
    }
    if best.0 > 0 { best.1 } else { WRAPPED.replace_all(opening(doc), " ").trim_matches(blank).to_owned() }
}

fn indexed_order(rows: &Rows, area: Option<&HashMap<&str, u32>>, a: IndexedRow, b: IndexedRow) -> Ordering {
    if a.kind != b.kind { return a.kind.cmp(&b.kind) }
    match a.kind {
        Kind::Published => published_hit(rows, a.row, 0, area).zip(published_hit(rows, b.row, 0, area))
            .map_or(Ordering::Equal, |(a, b)| compare_published(&a, &b)),
        Kind::Exported => export_hit(rows, a.row, 0).zip(export_hit(rows, b.row, 0))
            .map_or(Ordering::Equal, |(a, b)| compare_exported(&a, &b)),
    }
}

fn described_line(root: &str, layers: &[Layer], rows: &Rows, area: Option<&HashMap<&str, u32>>, hit: Row, words: &BTreeMap<String, String>) -> Option<(String, String)> {
    match hit {
        Row::Indexed(IndexedRow { kind: Kind::Published, row }) => {
            let mut hit = published_hit(rows, row, 0, area)?;
            count_published(root, layers, rows, std::slice::from_mut(&mut hit))?;
            let name = rows.string("names.name", hit.name)?;
            let next = symbol(name, hit.specifier);
            Some((published_line(&hit, name, words), next))
        }
        Row::Indexed(IndexedRow { kind: Kind::Exported, row }) => {
            let name = rows.number("exp.name", row)? as usize;
            let admits = |at: &str| area.is_none_or(|area| area.contains_key(at));
            let count = postings(rows, "names.expOff", "names.exp", name)?.into_iter()
                .filter(|&row| rows.string("exp.at", row).is_some_and(admits)).count();
            let pick = vec![(name, count, export_hit(rows, row, 3)?)];
            let (line, at) = exported_page(root, layers, rows, pick, admits, words)?.pop()?;
            Some((line, orient(&at)))
        }
        Row::Private(held) => {
            let line = format!("{} [{}] — {} · {}:{}{}", held.name, held.kind, owner(&held), held.at, held.line, summary(held.doc.as_deref(), words));
            Some((line, orient(&held.at)))
        }
        Row::File(held) => {
            let owner = if held.by.is_empty() { "the repository" } else { &held.by };
            let line = format!("{} [file] — {owner}{}", held.at, summary(held.doc.as_deref(), words));
            Some((line, orient(&held.at)))
        }
    }
}

fn loose_page(root: &str, layers: &[Layer], rows: &Rows, area: Option<&HashMap<&str, u32>>, loose: Loose, cap: usize, words: &BTreeMap<String, String>) -> Option<Vec<(String, String)>> {
    let mut published = loose.published.into_iter().map(|row| published_hit(rows, row, 0, area)).collect::<Option<Vec<_>>>()?;
    keep(&mut published, cap, compare_published);
    count_published(root, layers, rows, &mut published)?;
    published.sort_by(compare_published);
    let mut answer = Vec::new();
    for hit in published {
        let name = rows.string("names.name", hit.name)?;
        let next = symbol(name, hit.specifier);
        answer.push((published_line(&hit, name, words), next));
    }
    let admits = |at: &str| area.is_none_or(|area| area.contains_key(at));
    let mut exported = Vec::new();
    for (name, choices) in loose.exported {
        let count = if area.is_none() { rows.range("names.expOff", name)?.len() } else {
            postings(rows, "names.expOff", "names.exp", name)?.into_iter().filter(|&row| rows.string("exp.at", row).is_some_and(admits)).count()
        };
        let hit = choices.into_iter().map(|row| export_hit(rows, row, 2)).collect::<Option<Vec<_>>>()?.into_iter().min_by(compare_exported)?;
        exported.push((name, count, hit));
    }
    keep(&mut exported, cap.saturating_sub(answer.len()), |a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    for (line, at) in exported_page(root, layers, rows, exported, admits, words)? {
        answer.push((line, orient(&at)));
    }
    for held in loose.private.into_iter().take(cap.saturating_sub(answer.len())) {
        answer.push(described_line(root, layers, rows, area, Row::Private(held), words)?);
    }
    Some(answer)
}
