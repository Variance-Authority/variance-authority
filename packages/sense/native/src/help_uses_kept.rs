//! The declarations of a name no import reaches by it: the ones its files keep
//! to themselves or only bind, and the members of that name, each listed with
//! what reaches it, alone or after the imports of an exported one.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;

use crate::harvest::is_bound;
use crate::help_declared::DeclaredName;
use crate::help_members::MemberSite;
use crate::help_surface::{Surface, Value};
use crate::help_symbol_answer::{declaration_kind_order, kept_as, member_stop, unread_line};
use crate::help_symbol_published::joined_sites;
use crate::help_usage::{importers, Asked};

use super::{list_kinds, list_own, more_line, narrow, nearest, order_line, places, Asking, Counts};

/// The lines a kept name opens with, its declaring files' block first, and the rest: the binding files, the imports and each file's own uses.
pub(super) struct Keeping {
    pub first: Vec<String>,
    pub rest: Vec<String>,
}

impl Keeping {
    fn all(self) -> Vec<String> {
        let mut lines = self.first;
        lines.extend(self.rest);
        lines
    }
}

/// `uses` for a name no file exports: its member declarations, after the ones its files keep when one declares it, or before them.
pub(super) fn member_uses(asking: &Asking<'_>, member: &str, members: &[MemberSite], kept: &[&DeclaredName], unread: &[String]) -> Option<String> {
    let &Asking { name, from, file, .. } = asking;
    if members.is_empty() { return None }
    let declared = format!("declared in {}:", places(members.len()));
    let mut lines = if kept.iter().any(|held| !is_bound(&held.kind)) {
        let keeping = keeping(asking, kept)?;
        let mut lines = keeping.first;
        if file.is_none() { lines.extend(others_lines(name, Vec::new(), &[], &ordered(members, from))); }
        lines.extend(keeping.rest);
        lines.extend([String::new(), format!("`{name}` is a member too, {declared}")]);
        lines.extend(member_lines(asking, member, members));
        lines
    } else {
        let mut lines = vec![format!("`{name}` is no exported name; it is a member, {declared}")];
        lines.extend(member_lines(asking, member, members));
        if !kept.is_empty() {
            lines.push(String::new());
            lines.extend(keeping(asking, kept)?.all());
        }
        lines
    };
    lines.extend(unread_line(unread));
    let files: BTreeSet<_> = members.iter().map(|site| site.at.as_str()).chain(declaring(kept)).collect();
    if file.is_none() && files.len() > 1 { lines.push(narrow(asking.surface)); }
    Some(lines.join("\n"))
}

/// What follows the imports of an exported name: its kept declarations, the files not read, then its members.
pub(super) fn beside(asking: &Asking<'_>, member: &str, members: &[MemberSite], kept: &[&DeclaredName], unread: &[String]) -> Option<Vec<String>> {
    let name = asking.name;
    let mut lines = Vec::new();
    if !kept.is_empty() {
        lines.push(String::new());
        lines.extend(keeping(asking, kept)?.all());
    }
    lines.extend(unread_line(unread));
    if !members.is_empty() {
        lines.extend([String::new(), format!("`{name}` is a member too, declared in {}:", places(members.len()))]);
        // The imports already said the order, so the members do not say it again.
        lines.extend(member_lines(asking, member, members).into_iter().skip(1));
    }
    Some(lines)
}

/// Every declaration beside the one answered first, in the order the sections below answer them; nothing when there is none.
pub(super) fn others_lines(name: &str, namesakes: Vec<String>, kept: &[&DeclaredName], members: &[&MemberSite]) -> Vec<String> {
    let mut others = namesakes;
    let mut kept = kept.to_vec();
    kept.sort_by_key(|held| declaration_kind_order(held));
    others.extend(kept.iter().filter(|held| !is_bound(&held.kind)).map(|held| format!("{}:{}{}, not exported", held.at, held.line, spelled_as(&held.name, name))));
    others.extend(members.iter().map(|site| format!("{}:{}, a member of `{}`", site.at, site.line, site.on)));
    if others.is_empty() { return others }
    let count = others.len();
    let times = if count == 1 { "once more, as another thing".to_owned() } else { format!("{count} more times, each another thing") };
    let mut lines = vec![format!("It is declared {times}, answered below:")];
    lines.extend(others.into_iter().map(|one| format!("  {one}")));
    lines
}

/// The member declarations nearest `from` first, as the answer lists them.
pub(super) fn ordered<'m>(members: &'m [MemberSite], from: Option<&str>) -> Vec<&'m MemberSite> {
    let mut ordered: Vec<_> = members.iter().collect();
    ordered.sort_by(|a, b| nearest(from, &a.at, a.line, &b.at, b.line));
    ordered
}

/// The files that declare the name and keep it, each once.
pub(super) fn declaring<'k, 's>(kept: &'s [&'k DeclaredName]) -> impl Iterator<Item = &'k str> + use<'k, 's> {
    kept.iter().filter(|held| !is_bound(&held.kind)).map(|held| held.at.as_str())
}

/// The order line, the member declarations, the uses of each one on a named container, and where a type checker takes over.
fn member_lines(asking: &Asking<'_>, member: &str, members: &[MemberSite]) -> Vec<String> {
    let &Asking { layers, from, surface, .. } = asking;
    let mut lines = vec![order_line(asking)];
    let ordered = ordered(members, from);
    member_list(&mut lines, asking, "Member declarations:", ordered.len(), ordered.iter().map(|site| format!("{}:{} — {}", site.at, site.line, site.on)));
    let mut unused = Vec::new();
    for site in members {
        let Some(uses) = &site.uses else { continue };
        if uses.is_empty() {
            unused.push(format!("`{}` at {}:{}", site.on, site.at, site.line));
            continue;
        }
        let heading = format!("`{}.{member}`, declared at {}:{}, is used in {}:", site.on, site.at, site.line, places(uses.len()));
        let mut uses: Vec<_> = uses.iter().collect();
        uses.sort_by(|a, b| nearest(from, &a.at, a.line, &b.at, b.line));
        member_list(&mut lines, asking, &heading, uses.len(), uses.iter().map(|site| {
            let by = if site.by.is_empty() { String::new() } else { format!("{}, ", site.by) };
            format!("{}:{} — {by}{}", site.at, site.line, site.how)
        }));
    }
    if !unused.is_empty() {
        lines.extend([String::new(), format!("No line uses `{member}` through a value whose type is written as {}.", unused.join(", "))]);
    }
    let (named, where_, reference) = match members {
        [site] => {
            let named = site.uses.as_ref().map_or_else(|| member.to_owned(), |_| format!("{}.{member}", site.on));
            let where_ = format!("{}:{}", site.at, site.line);
            let reference = format!("`{named}` at {where_}");
            (named, where_, reference)
        }
        _ => (member.to_owned(), "the declaration you mean".into(), format!("the declaration you mean, each listed above with its file and line (`{}` narrows the declarations to one package)", surface.input("package"))),
    };
    lines.extend([
        String::new(),
        format!("An implementation of `{named}` that takes its type from where it goes — an argument, a property, a returned value — writes no type on its line and is not listed: TypeScript's language service's go-to-implementation on {where_} names it."),
        "A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends`, a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.".into(),
        format!("Ask TypeScript for those: its language service's find-references on {reference}."),
    ]);
    lines.extend(member_stop(layers, member, "there too"));
    lines
}

fn member_list(lines: &mut Vec<String>, asking: &Asking<'_>, heading: &str, count: usize, rows: impl Iterator<Item = String>) {
    let limit = asking.limit;
    lines.extend([String::new(), heading.to_owned(), String::new()]);
    lines.extend(rows.take(limit));
    if count > limit { lines.push(more_line(asking, count - limit)); }
}

/// `uses` for a name its files keep to themselves or only bind, and nothing exports.
pub(super) fn private_uses(asking: &Asking<'_>, declarations: &[DeclaredName], unread: &[String]) -> Option<String> {
    let file = asking.file;
    let selected: Vec<_> = declarations.iter().filter(|held| file.is_none_or(|file| held.at == file)).collect();
    let mut lines = keeping(asking, &selected)?.all();
    lines.extend(unread_line(unread));
    let declaring: BTreeSet<_> = declaring(&selected).collect();
    if file.is_none() && declaring.len() > 1 { lines.push(narrow(asking.surface)); }
    Some(lines.join("\n"))
}

/// What each kept row is and who can reach it, the imports that reach their files, and the lines of those files that use the name.
fn keeping(asking: &Asking<'_>, kept: &[&DeclaredName]) -> Option<Keeping> {
    let &Asking { root, layers, name, surface, .. } = asking;
    let mut selected = kept.to_vec();
    selected.sort_by_key(|held| declaration_kind_order(held));
    let first = selected.first()?;
    let files = files_of(&selected);
    let (bound, declaring): (Vec<_>, Vec<_>) = selected.iter().copied().partition(|held| is_bound(&held.kind));
    let (opening, mut rest) = if declaring.is_empty() { (kept_lines(name, &bound, surface), Vec::new()) } else { (kept_lines(name, &declaring, surface), kept_lines(name, &bound, surface)) };
    let declaring = files_of(&declaring);
    let asked = files.iter().map(|&file| Asked { file: file.to_owned(), name: name.to_owned() }).collect();
    let read = importers(root, layers, &[asked]);
    let group = read.groups.first()?;
    if !group.uses.is_empty() {
        let home = (!first.by.is_empty()).then_some(first.by.as_str());
        let sites = joined_sites(&[], [], &group.uses, &group.through);
        let count = Counts::of(&sites, home.unwrap_or(""));
        let split = home.map_or_else(String::new, |home| count.split(home));
        rest.push(format!("\nImported in {}{split}.{}", places(count.certain), count.may_read(name)));
        list_kinds(&mut rest, asking, home, sites);
    }
    let mut at = None;
    for site in &read.in_file {
        if at == Some(site.at.as_str()) { continue }
        list_own(&mut rest, asking, &site.at, if declaring.contains(site.at.as_str()) { "declares" } else { "binds" }, &read.in_file);
        at = Some(&site.at);
    }
    Some(Keeping { first: opening, rest })
}

fn files_of<'d>(rows: &[&'d DeclaredName]) -> BTreeSet<&'d str> {
    rows.iter().map(|held| held.at.as_str()).collect()
}

/// What each row is, where it is written and who can reach it there; every row is declared, or every one is bound.
fn kept_lines(name: &str, rows: &[&DeclaredName], surface: Surface<'_>) -> Vec<String> {
    match rows {
        [] => Vec::new(),
        [only] => vec![format!("`{name}` [{}] is {}, at {}:{}{}{}.", only.kind, kept_as(only), only.at, only.line, spelled(only, name), private_reach(only, surface))],
        [first, ..] => {
            let files = files_of(rows).len();
            let count = if files == rows.len() { format!("{files} files") } else { places(rows.len()) };
            let mut lines = vec![format!("`{name}` is {}, in {count}:", kept_as(first))];
            lines.extend(rows.iter().map(|held| format!("  {}:{}{} [{}]{}", held.at, held.line, spelled(held, name), held.kind, private_reach(held, surface))));
            lines
        }
    }
}

fn spelled(held: &DeclaredName, name: &str) -> String {
    if held.name == name { String::new() } else { format!(" as `{}`", held.name) }
}

/// How a declaration's own name differs from the one asked: its default, or another name.
fn spelled_as(spelled: &str, asked: &str) -> String {
    match spelled {
        _ if spelled == asked => String::new(),
        "default" => " as its default".into(),
        _ => format!(" as `{spelled}`"),
    }
}

fn private_reach(held: &DeclaredName, surface: Surface<'_>) -> String {
    if let Some(line) = held.holder_line {
        let holder = held.holder.as_ref().map(|name| format!("`{name}`"));
        let who = holder.clone().unwrap_or_else(|| format!("the function written at {}:{line}", held.at));
        let inside = holder.as_deref().unwrap_or("that function");
        return format!(", so only {who} can name it: it is declared inside {inside}");
    }
    match held.reach.as_deref() {
        Some("file") => ", so nothing outside that file can import it".into(),
        Some("module") => ", so only its module and the modules inside it can name it".into(),
        Some("underscore" | "all") => {
            let file = &held.at;
            let query = format!(r"\b{}\b", held.name);
            let ask = surface.question("grep", &[("query", Value::Text(&query)), ("to", Value::Text(file))]);
            format!("; another module can still import it by name, which {ask} finds")
        }
        _ => "; who can reach it is not recorded".into(),
    }
}
