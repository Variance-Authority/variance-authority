//! Import sites and same-file uses over a published source generation.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;
use std::fs::File;
use std::path::Path;

use crate::compact::Layer;
use crate::help_surface::{CLI, Value, typed};
use crate::harvest::is_bound;
use crate::help_aliases::aliases;
use crate::help_declared::{declared, DeclaredName, Matching};
use crate::help_in_file::InFile;
use crate::help_members::{member_declarations, MemberSite};
use crate::help_name_scope::{owner_of, PackageScope};
use crate::help_origin::declaration_exported;
use crate::help_symbol_answer::{declaration_kind_order, kept_as, member_name, member_stop, nowhere, unread_line};
use crate::help_symbol_published::{joined_sites, published_imports, PublicationScope};
use crate::help_symbol_rows::{Entry, Export, PathSite, Rows, Site};
use crate::help_usage::{importers, kind_of, Asked};
use crate::index_chain::OpenedChain;
use crate::order::code_unit;

const UNCOUNTED: &str = "a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted";
const NARROW: &str = "\n`--file`, the file one of them is declared in, answers for that declaration alone.";

pub(crate) fn uses(root: &str, index: &Path, store: &mut File, name: &str, wanted: Option<&str>, from: Option<&str>, file: Option<&str>, limit: usize) -> Option<String> {
    let mut rows = Rows::read(store)?;
    let published = rows.published(name)?;
    let path_rows = rows.path_uses(name)?;
    if !published.is_empty() { rows.read_entries(store)?; }
    if !path_rows.is_empty() {
        rows.read_paths(store)?;
    } else if wanted.is_some_and(|wanted| owner_of(wanted) != wanted) {
        rows.read_path_targets(store)?;
    }
    if published.is_empty() || wanted.is_some() { rows.read_export_lines(store)?; }
    let package = PackageScope::read(&rows, wanted)?;
    let mut entries = published.into_iter().map(|row| rows.entry(row)).collect::<Option<Vec<_>>>()?;
    entries.retain(|entry| package.entry(entry));
    let mut paths = path_rows.into_iter().map(|row| rows.path_site(row)).collect::<Option<Vec<_>>>()?;
    paths.retain(|path| package.path(path.specifier));
    let exports = rows.exports(name)?;
    let in_package = exports.iter().filter(|export| package.export(export)).cloned().collect::<Vec<_>>();
    let chain = OpenedChain::read(index.to_str()?).ok()??;
    let layers = chain.layers();
    let mut kept = declared(root, layers, name, Matching::Exact, None);
    kept.names.retain(|held| package.declared(&held.by));
    let (container, member) = member_name(name);
    let mut members = member_declarations(root, layers, member);
    members.retain(|site| package.member(&site.by) && container.is_none_or(|on| site.on == on));
    if entries.is_empty() && paths.is_empty() && in_package.is_empty() {
        if !aliases(root, layers, name).is_empty() { return None }
        if !members.is_empty() {
            if !kept.names.is_empty() { return None }
            members.retain(|site| file.is_none_or(|file| site.at == file));
            return member_uses(name, member, &members, from, file, limit, layers, &kept.unread);
        }
        if container.is_some() { return None }
        if kept.names.iter().any(|held| !is_bound(&held.kind)) {
            return private_uses(root, layers, name, from, file, limit, &kept.names, &kept.unread);
        }
        let absent = nowhere(name, &rows.published_names()?, layers, &kept.unread, None, wanted, package.export_hint(&rows, name, &exports)?.as_deref());
        if kept.names.is_empty() { return Some(absent) }
        // What was read is said with the absence, so the files it could not read are not said again.
        return Some(format!("{absent}\n\n{}", private_uses(root, layers, name, from, file, limit, &kept.names, &[])?));
    }
    if !members.is_empty() || !kept.names.is_empty() || !kept.unread.is_empty() { return None }
    if entries.is_empty() {
        return unpublished(root, layers, &rows, name, from, file, limit, &paths, &in_package, &package);
    }
    let (declarations, read) = published_imports(root, layers, name, entries, &exports, PublicationScope::Asked(&package))?;
    let mut selected: Vec<_> = declarations.iter().zip(&read.groups).collect();
    if let Some(file) = file {
        let at = selected.iter().position(|((entries, _), _)| entries[0].at == file)
            .or_else(|| selected.iter().position(|(_, group)| group.through.iter().any(|at| at == file)))?;
        selected = vec![selected[at]];
    }
    let mut answers = selected.into_iter();
    let ((lead, owner), group) = answers.next()?;
    let for_file = |at| paths.iter().filter(move |path| path.to == Some(at)).map(|path| path.site);
    let sites = joined_sites(lead, for_file(lead[0].at), &group.uses, &group.through);
    let kinds: BTreeSet<_> = lead.iter().map(|entry| entry.kind).collect();
    let kinds = kinds.into_iter().collect::<Vec<_>>().join(", ");
    let many = answers.len() > 0;
    let which = many.then(|| published_at(lead));
    let mut lines = vec![headline(name, &kinds, which.as_deref(), None, owner, &sites)];
    if many {
        let count = declarations.len() - 1;
        let times = if count == 1 { "once more, as another thing".to_owned() } else { format!("{count} more times, each another thing") };
        lines.push(format!("It is declared {times}, answered below:"));
        lines.extend(declarations[1..].iter().map(|(entries, _)| format!("  {}:{}, published by {}", entries[0].at, entries[0].line, publishers(entries))));
    }
    primary_sites(&mut lines, name, owner, lead[0].at, sites, &read.in_file, from, limit);
    for ((entries, owner), group) in answers {
        lines.push(format!("\n`{name}` is {} as well, which is another declaration.", published_at(entries)));
        let sites = joined_sites(entries, for_file(entries[0].at), &group.uses, &group.through);
        if sites.is_empty() {
            lines.push("Nothing in this workspace imports it.".into());
        } else {
            let count = Counts::of(&sites, owner);
            lines.push(format!("Imported in {}{}.{}", places(count.certain), count.split(owner), count.may_read(name)));
            list_kinds(&mut lines, name, Some(owner), sites, from, limit);
        }
        list_own(&mut lines, entries[0].at, "declares", &read.in_file, limit);
    }
    if many {
        lines.push(NARROW.into());
    }
    Some(lines.join("\n"))
}

fn member_uses(name: &str, member: &str, members: &[MemberSite], from: Option<&str>, file: Option<&str>, limit: usize, layers: &[Layer], unread: &[String]) -> Option<String> {
    if members.is_empty() { return None }
    let mut lines = vec![
        format!("`{name}` is no exported name; it is a member, declared in {}:", places(members.len())),
        from.map_or_else(|| "Path order; `--from` sorts nearest first.".into(), |from| format!("Nearest to {from} first.")),
    ];
    let mut ordered: Vec<_> = members.iter().collect();
    ordered.sort_by(|a, b| nearest(from, &a.at, a.line, &b.at, b.line));
    member_list(&mut lines, "Member declarations:", ordered.len(), limit, ordered.iter().map(|site| format!("{}:{} — {}", site.at, site.line, site.on)));
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
        member_list(&mut lines, &heading, uses.len(), limit, uses.iter().map(|site| {
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
        _ => (member.to_owned(), "the declaration you mean".into(), "the declaration you mean, each listed above with its file and line (`--package` narrows the declarations to one package)".into()),
    };
    lines.extend([
        String::new(),
        format!("An implementation of `{named}` that takes its type from where it goes — an argument, a property, a returned value — writes no type on its line and is not listed: TypeScript's language service's go-to-implementation on {where_} names it."),
        "A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends`, a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.".into(),
        format!("Ask TypeScript for those: its language service's find-references on {reference}."),
    ]);
    lines.extend(member_stop(layers, member, "there too"));
    lines.extend(unread_line(unread));
    if file.is_none() && members.iter().any(|site| site.at != members[0].at) { lines.push(NARROW.into()); }
    Some(lines.join("\n"))
}

fn member_list(lines: &mut Vec<String>, heading: &str, count: usize, limit: usize, rows: impl Iterator<Item = String>) {
    lines.extend([String::new(), heading.to_owned(), String::new()]);
    lines.extend(rows.take(limit));
    if count > limit { lines.push(format!("… {} more not shown; a higher `--limit` shows them.", count - limit)); }
}

fn private_uses(root: &str, layers: &[Layer], name: &str, from: Option<&str>, file: Option<&str>, limit: usize, declarations: &[DeclaredName], unread: &[String]) -> Option<String> {
    let mut selected: Vec<_> = declarations.iter().filter(|held| file.is_none_or(|file| held.at == file)).collect();
    selected.sort_by_key(|held| declaration_kind_order(held));
    let first = selected.first()?;
    let files = files_of(&selected);
    let (bound, declaring): (Vec<_>, Vec<_>) = selected.iter().copied().partition(|held| is_bound(&held.kind));
    let mut lines = kept_lines(name, &declaring);
    lines.extend(kept_lines(name, &bound));
    let declaring = files_of(&declaring);
    let asked = files.iter().map(|&file| Asked { file: file.to_owned(), name: name.to_owned() }).collect();
    let read = importers(root, layers, &[asked]);
    let group = read.groups.first()?;
    if !group.uses.is_empty() {
        let home = (!first.by.is_empty()).then_some(first.by.as_str());
        let sites = joined_sites(&[], [], &group.uses, &group.through);
        let count = Counts::of(&sites, home.unwrap_or(""));
        let split = home.map_or_else(String::new, |home| count.split(home));
        lines.push(format!("\nImported in {}{split}.{}", places(count.certain), count.may_read(name)));
        list_kinds(&mut lines, name, home, sites, from, limit);
    }
    let mut at = None;
    for site in &read.in_file {
        if at == Some(site.at.as_str()) { continue }
        list_own(&mut lines, &site.at, if declaring.contains(site.at.as_str()) { "declares" } else { "binds" }, &read.in_file, limit);
        at = Some(&site.at);
    }
    lines.extend(unread_line(unread));
    if file.is_none() && declaring.len() > 1 { lines.push(NARROW.into()); }
    Some(lines.join("\n"))
}

fn files_of<'d>(rows: &[&'d DeclaredName]) -> BTreeSet<&'d str> {
    rows.iter().map(|held| held.at.as_str()).collect()
}

/// What each row is, where it is written and who can reach it there; every row is declared, or every one is bound.
fn kept_lines(name: &str, rows: &[&DeclaredName]) -> Vec<String> {
    match rows {
        [] => Vec::new(),
        [only] => vec![format!("`{name}` [{}] is {}, at {}:{}{}{}.", only.kind, kept_as(only), only.at, only.line, spelled(only, name), private_reach(only))],
        [first, ..] => {
            let files = files_of(rows).len();
            let count = if files == rows.len() { format!("{files} files") } else { places(rows.len()) };
            let mut lines = vec![format!("`{name}` is {}, in {count}:", kept_as(first))];
            lines.extend(rows.iter().map(|held| format!("  {}:{}{} [{}]{}", held.at, held.line, spelled(held, name), held.kind, private_reach(held))));
            lines
        }
    }
}

fn spelled(held: &DeclaredName, name: &str) -> String {
    if held.name == name { String::new() } else { format!(" as `{}`", held.name) }
}

fn private_reach(held: &DeclaredName) -> String {
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
            let ask = typed(CLI, "grep", &[("query", Value::Text(&query)), ("to", Value::Text(file))]);
            format!("; another module can still import it by name, which `{ask}` finds")
        }
        _ => "; who can reach it is not recorded".into(),
    }
}

fn unpublished(root: &str, layers: &[Layer], rows: &Rows, name: &str, from: Option<&str>, file: Option<&str>, limit: usize, paths: &[PathSite<'_>], exports: &[Export<'_>], package: &PackageScope<'_>) -> Option<String> {
    let [export] = exports else { return None };
    if export.name != name || export.bound != Some(name) || kind_of(export.at) != "source" || export.by.is_empty() || file.is_some_and(|file| file != export.at)
        || paths.iter().any(|site| site.to != Some(export.at)) {
        return None;
    }
    let declared = declaration_exported(layers, export.at, name)?;
    let mut imports = importers(root, layers, &[vec![Asked { file: export.at.to_owned(), name: name.to_owned() }]]);
    if !imports.namespaces.is_empty() { return None }
    let group = imports.groups.first_mut()?;
    group.uses.retain(|site| package.through(&site.key));
    let sites = joined_sites(&[], paths.iter().map(|site| site.site), &group.uses, &group.through);
    let exported_at = format!("{}:{}", export.at, rows.export_line(export)?);
    let mut lines = vec![headline(name, &declared.kind, None, Some(&exported_at), export.by, &sites)];
    primary_sites(&mut lines, name, export.by, export.at, sites, &imports.in_file, from, limit);
    Some(lines.join("\n"))
}

fn primary_sites(lines: &mut Vec<String>, name: &str, owner: &str, at: &str, sites: Vec<Site<'_>>, own: &[InFile], from: Option<&str>, limit: usize) {
    let imported = !sites.is_empty();
    if imported {
        lines.push(from.map_or_else(|| "Path order; `--from` sorts nearest first.".into(), |from| format!("Nearest to {from} first.")));
        list_kinds(lines, name, Some(owner), sites, from, limit);
    }
    list_own(lines, at, "declares", own, limit);
    if imported { lines.push(format!("\nA{}.", &UNCOUNTED[1..])); }
}

fn publishers(entries: &[Entry<'_>]) -> String {
    entries.iter().map(|entry| entry.specifier).collect::<Vec<_>>().join(", ")
}

fn published_at(entries: &[Entry<'_>]) -> String {
    format!("published by {}, declared at {}:{}", publishers(entries), entries[0].at, entries[0].line)
}

fn headline(name: &str, kinds: &str, published: Option<&str>, exported: Option<&str>, home: &str, sites: &[Site<'_>]) -> String {
    let named = format!("`{name}` [{kinds}]");
    if sites.is_empty() {
        if let Some(at) = exported {
            return format!("{named} is exported, without being published, at {at}, and nothing in this workspace imports it; {UNCOUNTED}.");
        }
        let published = published.map_or_else(|| "published".into(), |at| format!("{at},"));
        return format!("{named} is {published} and nothing in this workspace imports it; {UNCOUNTED}. `variance ask symbol` has its signature and what is written above it.");
    }
    let which = match (published, exported) {
        (Some(at), _) => format!(", {at}"),
        (_, Some(at)) => format!(", and no entry publishes it; it is exported at {at}"),
        _ => String::new(),
    };
    let count = Counts::of(sites, home);
    let taken = if count.certain == 0 {
        format!("{named} is imported by name nowhere{which}.")
    } else {
        let loaded = if count.dynamic == 0 { ".".into() } else {
            format!(", {} through import(), which loads the module when the call runs.", count.dynamic)
        };
        format!("{named} is imported in {}{}{which}{loaded}", places(count.certain), count.split(home))
    };
    format!("{taken}{}", count.may_read(name))
}

fn places(count: usize) -> String {
    format!("{count} {}", if count == 1 { "place" } else { "places" })
}

pub(super) struct Counts {
    pub(super) certain: usize,
    inside: usize,
    pub(super) off: usize,
    pub(super) whole: usize,
    dynamic: usize,
}

impl Counts {
    pub(super) fn of(sites: &[Site<'_>], home: &str) -> Self {
        let mut count = Self { certain: 0, inside: 0, off: 0, whole: 0, dynamic: 0 };
        for site in sites {
            if site.off {
                count.off += 1;
            } else if site.whole {
                count.whole += 1;
            } else {
                count.certain += 1;
                count.inside += usize::from(site.by == home);
                count.dynamic += usize::from(!site.type_only && matches!(site.through, Some(("dynamic", _))));
            }
        }
        count
    }

    pub(super) fn split(&self, home: &str) -> String {
        let outside = self.certain - self.inside;
        match (outside, self.inside) {
            (0, 0) => String::new(),
            (0, 1) => format!(", inside {home}"),
            (0, _) => format!(", all inside {home}"),
            (1, 0) => ", from another package".into(),
            (_, 0) => ", all from other packages".into(),
            _ => format!(": {outside} from {} and {} inside {home}", if outside == 1 { "another package" } else { "other packages" }, self.inside),
        }
    }

    fn may_read(&self, name: &str) -> String {
        let mut lines = String::new();
        if self.off > 0 {
            let reads = if self.off == 1 { "reads" } else { "read" };
            let count = if self.certain == 0 { places(self.off) } else { format!("{} more", self.off) };
            lines.push_str(&format!(" {count} {reads} it off the module's `default`, which holds `{name}` only when the module is CommonJS."));
        }
        if self.whole > 0 {
            let passes = if self.whole == 1 { "passes" } else { "pass" };
            let count = if self.certain + self.off == 0 { places(self.whole) } else { format!("{} more", self.whole) };
            lines.push_str(&format!(" {count} {passes} the module on whole, where this reading does not follow it, and may read `{name}`."));
        }
        lines
    }
}

fn nearest(from: Option<&str>, at: &str, line: u32, other_at: &str, other_line: u32) -> std::cmp::Ordering {
    let shared = |at: &str| from.map_or(0, |from| from.split('/').zip(at.split('/')).take_while(|(a, b)| a == b).count());
    shared(other_at).cmp(&shared(at)).then_with(|| code_unit(at, other_at)).then(line.cmp(&other_line))
}

fn list_kinds(lines: &mut Vec<String>, name: &str, home: Option<&str>, mut sites: Vec<Site<'_>>, from: Option<&str>, limit: usize) {
    sites.sort_by(|a, b| nearest(from, a.at, a.line, b.at, b.line));
    for (kind, heading) in [("story", "Stories"), ("test", "Tests"), ("source", "Source")] {
        let of = sites.iter().filter(|site| site.kind == kind);
        let Some(home) = home else {
            let rows: Vec<_> = of.collect();
            list(lines, &format!("{heading}:"), rows.iter().map(|site| site_line(site, name, false, limit)), limit);
            continue;
        };
        let (outside, inside): (Vec<_>, Vec<_>) = of.partition(|site| site.by != home);
        list(lines, &format!("{heading}, from other packages:"), outside.iter().map(|site| site_line(site, name, false, limit)), limit);
        list(lines, &format!("{heading}, inside {home}:"), inside.iter().map(|site| site_line(site, name, true, limit)), limit);
    }
}

fn list_own(lines: &mut Vec<String>, at: &str, does: &str, uses: &[InFile], limit: usize) {
    let start = uses.partition_point(|site| code_unit(&site.at, at).is_lt());
    let group = &uses[start..];
    let end = group.partition_point(|site| site.at == at);
    if end == 0 { return }
    let by = &group[0].by;
    let who = if by.is_empty() { String::new() } else { format!(" — {by}") };
    list(lines, &format!("Used in {at}{who}, which {does} it:"), group[..end].iter().map(|site| format!("  {}", site.line)), limit);
}

fn list(lines: &mut Vec<String>, heading: &str, rows: impl ExactSizeIterator<Item = String>, limit: usize) {
    let count = rows.len();
    if count == 0 { return }
    lines.extend([String::new(), heading.to_owned(), String::new()]);
    lines.extend(rows.take(limit));
    if count > limit {
        lines.push(format!("… {} more not shown; a higher `--limit` shows them.", count - limit));
    }
}

fn site_line(site: &Site<'_>, name: &str, inside: bool, limit: usize) -> String {
    let mut text = format!("{}:{}", site.at, site.line);
    if !inside { text.push_str(&format!(" — {}", site.by)); }
    if let Some((kind, specifier)) = site.path { text.push_str(&kind.how(specifier)); }
    if let Some(local) = site.local.filter(|local| *local != name) {
        text.push_str(&format!(" (as {local})"));
    }
    if site.type_only { text.push_str(" (type only)"); }
    if let Some((kind, line)) = site.through {
        let loaded = if kind == "dynamic" { format!("import() on line {line}") } else { format!("namespace, line {line}") };
        text.push_str(&format!(" ({loaded}"));
        if site.off { text.push_str(", through `default`: may read it"); }
        if site.whole { text.push_str(", passed on whole: may read it"); }
        text.push(')');
    }
    if let Some(lines) = site.lines.filter(|lines| !lines.is_empty()) {
        let noun = if lines.len() == 1 { "line" } else { "lines" };
        text.push_str(&format!("; used on {noun} {}", lines.iter().take(limit).map(u32::to_string).collect::<Vec<_>>().join(", ")));
        if lines.len() > limit { text.push_str(&format!(" and {} more", lines.len() - limit)); }
    }
    text
}
