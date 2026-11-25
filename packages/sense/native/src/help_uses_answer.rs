//! Import sites and same-file uses over a published source generation.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;
use std::fs::File;
use std::path::Path;

use crate::compact::Layer;
use crate::harvest::is_bound;
use crate::help_aliases::aliases;
use crate::help_declared::{declared, DeclaredName, Matching};
use crate::help_in_file::InFile;
use crate::help_members::{member_declarations, MemberSite};
use crate::help_name_scope::{owner_of, PackageScope};
use crate::help_symbol_answer::{member_name, nowhere};
use crate::help_symbol_published::{joined_sites, published_imports, PublicationScope};
use crate::help_symbol_rows::{Entry, Rows, Site};
use crate::index_chain::OpenedChain;
use crate::help_unpublished::{exports_named, UNCOUNTED};
use crate::order::code_unit;

#[path = "help_uses_exported.rs"]
mod exported;
#[path = "help_uses_kept.rs"]
mod kept;

/// What an exported name's answer says beside its imports: the kept and member declarations it names under the headline, what follows the imports, and their files.
struct Beside<'a> {
    kept: Vec<&'a DeclaredName>,
    members: Vec<&'a MemberSite>,
    after: Vec<String>,
    files: Vec<&'a str>,
}

/// One `uses` question: the checkout and index it reads, the name, and how its answer is ordered and cut.
struct Asking<'q> {
    root: &'q str,
    layers: &'q [Layer<'q>],
    name: &'q str,
    from: Option<&'q str>,
    file: Option<&'q str>,
    limit: usize,
}

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
    // `--package` can leave a published name nothing published, which is answered from its exports.
    if published.is_empty() || wanted.is_some() { rows.read_exported(store)?; }
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
    let exported = if entries.is_empty() { exports_named(&rows, layers, name, &exports, &in_package)? } else { Vec::new() };
    let kept_here: Vec<&DeclaredName> = kept.names.iter().filter(|held| file.is_none_or(|file| held.at == file)).collect();
    // A name nothing declares anywhere is answered as one before the files that bind it, whichever file was asked.
    let nothing = entries.is_empty() && paths.is_empty() && exported.is_empty() && members.is_empty();
    members.retain(|site| file.is_none_or(|file| site.at == file));
    // A file that keeps the name, or declares it as a member, answers for that declaration and not for an export's.
    let elsewhere = file.is_some_and(|file| (!kept_here.is_empty() || !members.is_empty())
        && !entries.iter().any(|entry| entry.at == file) && !exported.iter().any(|held| held.export.at == file && held.export.bound.is_some()));
    if (entries.is_empty() && paths.is_empty() && exported.is_empty()) || elsewhere {
        if !aliases(root, layers, name).is_empty() { return None }
        if !members.is_empty() {
            return kept::member_uses(root, layers, name, member, &members, &kept_here, from, file, limit, &kept.unread);
        }
        if container.is_some() { return None }
        if kept.names.iter().any(|held| !is_bound(&held.kind)) {
            return kept::private_uses(root, layers, name, from, file, limit, &kept.names, &kept.unread);
        }
        let absent = nowhere(name, &rows.published_names()?, layers, &kept.unread, None, wanted, package.export_hint(&rows, name, &exports)?.as_deref());
        if kept.names.is_empty() { return Some(absent) }
        if !nothing { return kept::private_uses(root, layers, name, from, file, limit, &kept.names, &kept.unread) }
        // What was read is said with the absence, so the files it could not read are not said again.
        return Some(format!("{absent}\n\n{}", kept::private_uses(root, layers, name, from, file, limit, &kept.names, &[])?));
    }
    let beside = Beside {
        kept: if file.is_none() { kept_here.clone() } else { Vec::new() },
        members: if file.is_none() { kept::ordered(&members, from) } else { Vec::new() },
        after: kept::beside(root, layers, name, member, &members, &kept_here, from, limit, &kept.unread)?,
        files: kept::declaring(&kept_here).chain(members.iter().map(|site| site.at.as_str())).collect(),
    };
    if entries.is_empty() {
        if exported.is_empty() { return None }
        return exported::exported_uses(&Asking { root, layers, name, from, file, limit }, &rows, &paths, &exported, &package, beside);
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
    let namesakes = if answers.len() > 0 { declarations[1..].iter().map(|(entries, _)| format!("{}:{}, published by {}", entries[0].at, entries[0].line, publishers(entries))).collect() } else { Vec::new() };
    let others = kept::others_lines(name, namesakes, &beside.kept, &beside.members);
    let which = (!others.is_empty()).then(|| published_at(lead));
    let mut lines = vec![headline(name, &kinds, which.as_deref(), None, owner, &sites)];
    lines.extend(others);
    primary_sites(&mut lines, name, owner, &[lead[0].at], sites, &read.in_file, from, limit);
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
    lines.extend(beside.after);
    let files: BTreeSet<_> = declarations.iter().map(|(entries, _)| entries[0].at).chain(beside.files).collect();
    if file.is_none() && files.len() > 1 { lines.push(NARROW.into()); }
    Some(lines.join("\n"))
}

/// The imports of the declaration answered first, then the lines of each of `files` that use it.
#[allow(clippy::too_many_arguments)]
fn primary_sites(lines: &mut Vec<String>, name: &str, owner: &str, files: &[&str], sites: Vec<Site<'_>>, own: &[InFile], from: Option<&str>, limit: usize) {
    let imported = !sites.is_empty();
    if imported {
        lines.push(from.map_or_else(|| "Path order; `--from` sorts nearest first.".into(), |from| format!("Nearest to {from} first.")));
        list_kinds(lines, name, Some(owner), sites, from, limit);
    }
    for at in files { list_own(lines, at, "declares", own, limit); }
    if imported { lines.push(format!("\nA{}.", &UNCOUNTED[1..])); }
}

fn publishers(entries: &[Entry<'_>]) -> String {
    entries.iter().map(|entry| entry.specifier).collect::<Vec<_>>().join(", ")
}

fn published_at(entries: &[Entry<'_>]) -> String {
    format!("published by {}, declared at {}:{}", publishers(entries), entries[0].at, entries[0].line)
}

fn headline(name: &str, kinds: &str, published: Option<&str>, exported: Option<(&str, Option<&str>)>, home: &str, sites: &[Site<'_>]) -> String {
    let named = if kinds.is_empty() { format!("`{name}`") } else { format!("`{name}` [{kinds}]") };
    if sites.is_empty() {
        if let Some((at, member)) = exported {
            let how = member.map_or_else(|| format!("exported, without being published, at {at}"), |member| format!("{member}, and exported at {at}"));
            return format!("{named} is {how}, and nothing in this workspace imports it; {UNCOUNTED}.");
        }
        let published = published.map_or_else(|| "published".into(), |at| format!("{at},"));
        return format!("{named} is {published} and nothing in this workspace imports it; {UNCOUNTED}. `variance ask symbol` has its signature and what is written above it.");
    }
    let which = match (published, exported) {
        (Some(at), _) => format!(", {at}"),
        (_, Some((at, member))) => format!(", {}; it is exported at {at}", member.unwrap_or("and no entry publishes it")),
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
