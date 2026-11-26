//! Import sites and same-file uses over a published source generation.

// compass: variance-authority.report.agent-surface

use std::cell::RefCell;
use std::io::{Read, Seek};

use crate::compact::Layer;
use crate::harvest::is_bound;
use crate::help_aliases::aliases;
use crate::help_declared::{declared, DeclaredName, Matching};
use crate::help_in_file::InFile;
use crate::help_key::{can_keep, nearest, Keys, SLOT};
use crate::help_members::{member_declarations, MemberSite};
use crate::help_name_scope::{owner_of, PackageScope};
use crate::help_symbol_answer::{container_absence, DECLARED_CAP, member_name, member_stop, nowhere, unread_line};
use crate::help_declared_in::{joined, publishing, rows_of, Readings};
use crate::help_symbol_published::published_declarations;
use crate::help_surface::Surface;
use crate::help_symbol_rows::{Rows, Site};
use crate::help_usage::{importers, Asked, Importers, NameUse};
use crate::help_unpublished::{exports_named, UNCOUNTED};
use crate::help_unread::{Said, STORE};
use crate::order::code_unit;

#[path = "help_uses_exported.rs"]
mod exported;
#[path = "help_uses_kept.rs"]
mod kept;
#[path = "help_uses_published.rs"]
mod published;

/// What an exported name's answer says beside its imports: the kept and member declarations it names under the headline, what follows the imports, and their files.
struct Beside<'a> {
    kept: Vec<&'a DeclaredName>,
    members: Vec<&'a MemberSite>,
    after: Vec<String>,
    files: Vec<&'a str>,
}

/// One `uses` question: the checkout and index it reads, the name, how its
/// answer is ordered and cut, and the surface whose spelling it is said in.
pub(crate) struct Asking<'q> {
    pub root: &'q str,
    pub layers: &'q [Layer<'q>],
    pub name: &'q str,
    pub wanted: Option<&'q str>,
    pub from: Option<&'q str>,
    pub file: Option<&'q str>,
    /// Rows of each kind shown, [`SHOWN`] when the question says none.
    pub limit: Option<usize>,
    pub surface: Surface<'q>,
    /// What the answer read, collected as it is said: [`Listed`].
    pub listed: RefCell<Listed>,
}

/// Sites of one kind shown when the question says no limit: how many are worth naming before the list stops being read.
const SHOWN: usize = 12;

impl Asking<'_> {
    /// Rows of each kind this answer shows.
    pub(crate) fn shown(&self) -> usize { self.limit.unwrap_or(SHOWN) }
}

/// The files a `uses` answer lists and rests on, every row and not only those shown.
#[derive(Default)]
pub(crate) struct Listed {
    /// Every site, line of a declaring file, member declaration and use, and kept declaration, at its line.
    pub sites: Vec<(String, u32)>,
    /// Each file that passes a published declaration on between its entry and its file.
    pub through: Vec<String>,
    /// The files that declare, bind and publish the name; none when no file of the checkout does.
    pub rests: Option<Vec<String>>,
    pub unread: Vec<String>,
}

impl Listed {
    /// The files the answer lists, each with its lines, ascending, once.
    pub(crate) fn files(&self) -> Vec<(String, Vec<u32>)> {
        let mut files: Vec<(String, Vec<u32>)> = Vec::new();
        let mut at = std::collections::HashMap::new();
        for (file, line) in &self.sites {
            let held = *at.entry(file.as_str()).or_insert_with(|| { files.push((file.clone(), Vec::new())); files.len() - 1 });
            files[held].1.push(*line);
        }
        for (_, lines) in &mut files { lines.sort_unstable(); lines.dedup(); }
        files
    }

    /// The files the answer rests on: those that declare and publish the name, then each it lists.
    pub(crate) fn printed(&self) -> Vec<String> {
        let listed = self.files().into_iter().map(|(file, _)| file);
        match &self.rests {
            Some(rests) => rests.iter().cloned().chain(self.through.iter().cloned()).chain(listed).collect(),
            None => listed.collect(),
        }
    }
}

/// The line that says how to narrow an answer naming several declaring files to one.
fn narrow(surface: Surface<'_>) -> String {
    format!("\n`{}`, the file one of them is declared in, answers for that declaration alone.", surface.input("file"))
}

/// Who uses the name `asking` names, read from the help store `store` and the
/// index layers it carries: `Err` inside when the answer is that nothing
/// declares it, and `Err` outside, saying why, when the answer did not read.
pub(crate) fn uses(asking: &Asking<'_>, store: &mut (impl Read + Seek)) -> Result<Result<String, String>, String> {
    let &Asking { root, layers, name, wanted, from, file, .. } = asking;
    let mut rows = Rows::read(store).said(STORE)?;
    let published = rows.published(name).said(STORE)?;
    // The entries are read for a name published, bound by an import, or published under another name of its declaration.
    let entries = !published.is_empty() || !aliases(root, layers, name).is_empty() || rows.publishes_declared(&rows.exported_beside(name).said(STORE)?).said(STORE)?;
    let path_rows = rows.path_uses(name).said(STORE)?;
    // A declaration published under another name is imported by path by the name it is declared by.
    let mut by_declared = false;
    for &row in &published { let declared = rows.string("pub.declared", row).said(STORE)?; by_declared |= declared != name && !rows.path_uses(declared).said(STORE)?.is_empty(); }
    if entries { rows.read_entries(store).said(STORE)?; }
    if !path_rows.is_empty() || by_declared {
        rows.read_paths(store).said(STORE)?;
    } else if wanted.is_some_and(|wanted| owner_of(wanted) != wanted) {
        rows.read_path_targets(store).said(STORE)?;
    }
    // Which declaration an export is, and the name it is keyed by, is read off the export list.
    rows.read_exported(store).said(STORE)?;
    let package = PackageScope::read(&rows, wanted).said(STORE)?;
    let mut paths = path_rows.into_iter().map(|row| rows.path_site(row)).collect::<Option<Vec<_>>>().said(STORE)?;
    paths.retain(|path| package.path(path.specifier));
    let exports = rows.exports(name).said(STORE)?;
    let mut kept = declared(root, layers, name, Matching::Exact, None);
    kept.names.retain(|held| package.declared(&held.by) && can_keep(held));
    let (container, member) = member_name(name);
    let mut members = member_declarations(root, layers, member);
    members.retain(|site| package.member(&site.by) && container.is_none_or(|on| site.on == on));
    let keys = Keys::new(root, layers, &rows);
    let published = if entries { published_declarations(&keys, name, &package)? } else { Vec::new() };
    let exported = exports_named(&keys, name, &package).said(STORE)?;
    // Asked for the slot, a file imported by path answers only when its default is one nothing names.
    if name == SLOT && published.is_empty() {
        let mut answering = Vec::with_capacity(paths.len());
        for site in paths { if site.to.map_or(Some(true), |to| keys.answers(to, SLOT, SLOT)).said(STORE)? { answering.push(site) } }
        paths = answering;
    }
    {
        let every: Vec<_> = exported.iter().collect();
        let read = Readings { name, member, published: &published, paths: &paths, exports: &exports, declared: &kept.names, members: &members };
        let resting = rows_of(&read, &rows, layers, &every, true, &[]).said(STORE)?;
        let mut listed = asking.listed.borrow_mut();
        listed.rests = (!resting.is_empty()).then(|| joined(resting).0.into_iter().map(|(file, _)| file).chain(publishing(&published, &[])).collect());
        listed.unread.extend(unread_line(&kept.unread));
        listed.unread.extend(member_stop(layers, member, if members.is_empty() { "there" } else { "there too" }));
    }
    let kept_here: Vec<&DeclaredName> = kept.names.iter().filter(|held| file.is_none_or(|file| held.at == file)).collect();
    // A file named that declares nothing by the name, and passes no declaration of it on, is answered by the files that do.
    let undeclared = file.filter(|file| !published.iter().any(|one| one.at == *file)
        && !exported.iter().any(|held| held.export.at == *file)
        && kept_here.is_empty() && !members.iter().any(|site| site.at == *file))
        .and_then(|file| not_declared_in(name, file, &published, &exported, &kept.names, &members));
    // A name nothing declares anywhere is answered as one before the files that bind it, whichever file was asked.
    let nothing = published.is_empty() && paths.is_empty() && exported.is_empty() && members.is_empty();
    members.retain(|site| file.is_none_or(|file| site.at == file));
    // A file that keeps the name, or declares it as a member, answers for that declaration and not for an export's.
    let elsewhere = file.is_some_and(|file| (!kept_here.is_empty() || !members.is_empty())
        && !published.iter().any(|one| one.at == file) && !exported.iter().any(|held| held.export.at == file && held.export.bound.is_some()));
    if (published.is_empty() && paths.is_empty() && exported.is_empty()) || elsewhere {
        if !members.is_empty() {
            return kept::member_uses(asking, member, &members, &kept_here, &kept.unread).said(STORE).map(Ok);
        }
        if kept.names.iter().any(|held| !is_bound(&held.kind)) {
            return kept::private_uses(asking, &kept.names, &kept.unread).said(STORE).map(Ok);
        }
        if let Some(undeclared) = undeclared { return Ok(Err(undeclared)) }
        let absence = container_absence(&keys, root, layers, name, &package, asking.limit.unwrap_or(DECLARED_CAP), asking.surface).said(STORE)?;
        let absent = nowhere(name, &rows.published_names().said(STORE)?, layers, &kept.unread, None, wanted, package.export_hint(&rows, name, &exports).said(STORE)?.as_deref(), absence, asking.surface);
        if kept.names.is_empty() { return Ok(Err(absent)) }
        if !nothing { return kept::private_uses(asking, &kept.names, &kept.unread).said(STORE).map(Ok) }
        // What was read is said with the absence, so the files it could not read are not said again.
        return Ok(Ok(format!("{absent}\n\n{}", kept::private_uses(asking, &kept.names, &[]).said(STORE)?)));
    }
    let beside = Beside {
        kept: if file.is_none() { kept_here.clone() } else { Vec::new() },
        members: if file.is_none() { kept::ordered(&members, from) } else { Vec::new() },
        after: kept::beside(asking, member, &members, &kept_here, &kept.unread).said(STORE)?,
        files: kept::declaring(&kept_here).chain(members.iter().map(|site| site.at.as_str())).collect(),
    };
    if published.is_empty() {
        if let Some(undeclared) = undeclared { return Ok(Err(undeclared)) }
        if exported.is_empty() { return Ok(Ok(path_uses(asking, &paths))) }
        return exported::exported_uses(asking, &rows, &paths, &exported, &package, beside).map(Ok);
    }
    // A file a door opens, or a barrel between it and the declaration, passes the published one on.
    match published::published_uses(asking, &keys, &paths, published, &exported, &package, beside) {
        None => undeclared.map(Err).said(STORE),
        Some(answered) => Ok(Ok(answered)),
    }
}

/// The answer for a `file` that declares no thing by the name: the files that
/// do, or the ones that only bind it when none does; `None` when no file does either.
fn not_declared_in(name: &str, file: &str, published: &[crate::help_symbol_published::Declaration<'_>], exported: &[crate::help_unpublished::Unpublished<'_>], kept: &[DeclaredName], members: &[MemberSite]) -> Option<String> {
    let mut files: Vec<&str> = published.iter().map(|one| one.at)
        .chain(exported.iter().filter(|held| held.export.bound.is_some()).map(|held| held.export.at))
        .chain(kept.iter().filter(|held| !is_bound(&held.kind)).map(|held| held.at.as_str()))
        .chain(members.iter().map(|site| site.at.as_str())).collect();
    let declared = !files.is_empty();
    if !declared { files = kept.iter().map(|held| held.at.as_str()).collect() }
    files.sort_by(|a, b| code_unit(a, b));
    files.dedup();
    let (last, earlier) = files.split_last()?;
    let all = if earlier.is_empty() { (*last).to_owned() } else { format!("{} and {last}", earlier.join(", ")) };
    Some(format!("`{name}` is not declared in {file}; it is {} in {all}.", if declared { "declared" } else { "bound" }))
}

/// Who imports each group of `asked`, a line two names of one group reach
/// being one use with the lines of each: `import greet, { greet as g2 }`
/// imports one declaration under two of its names.
fn importers_of_every(root: &str, layers: &[Layer], asked: &[Vec<Asked>]) -> Importers {
    let mut read = importers(root, layers, asked);
    let mut joined = false;
    for (group, names) in read.groups.iter_mut().zip(asked) {
        if names.iter().all(|one| one.name == names[0].name) { continue }
        joined = true;
        let mut uses: Vec<NameUse> = Vec::with_capacity(group.uses.len());
        for one in group.uses.drain(..) {
            match uses.last_mut().filter(|held| held.at == one.at && held.line == one.line) {
                Some(held) => if let Some(lines) = one.lines {
                    let mut all = held.lines.take().unwrap_or_default();
                    all.extend(lines);
                    all.sort_unstable();
                    all.dedup();
                    held.lines = Some(all);
                },
                None => uses.push(one),
            }
        }
        group.uses = uses;
    }
    if joined { read.in_file.dedup_by(|a, b| a.at == b.at && a.line == b.line) }
    read
}

/// How the sites below are ordered: by path, or nearest the file `from` names.
fn order_line(asking: &Asking<'_>) -> String {
    asking.from.map_or_else(|| format!("Path order; `{}` sorts nearest first.", asking.surface.input("from")), |from| format!("Nearest to {from} first."))
}

/// The imports of the declaration answered first, then the lines of each of `files` that use it.
fn primary_sites(lines: &mut Vec<String>, asking: &Asking<'_>, owner: &str, files: &[&str], sites: Vec<Site<'_>>, strays: Strays<'_>, own: &[InFile]) {
    let imported = !sites.is_empty() || !strays.dead.is_empty() || !strays.unresolved.is_empty();
    if imported {
        lines.push(order_line(asking));
        // An export no package owns has no inside to set apart: every site lists with its owner.
        list_kinds(lines, asking, (!owner.is_empty()).then_some(owner), sites);
        stray_sites(lines, asking, strays.dead, DEAD);
        stray_sites(lines, asking, strays.unresolved, UNRESOLVED);
    }
    for at in files { list_own(lines, asking, at, "declares", own); }
    if imported { lines.push(format!("\nA{}.", &UNCOUNTED[1..])); }
}

/// The imports by path no declaration read here is credited with, listed apart.
#[derive(Default)]
pub(super) struct Strays<'a> {
    /// Each reaching a file that exports no declaration of the name read here.
    pub dead: Vec<Site<'a>>,
    /// Each naming a package the source index resolved to no file: where it leads is not known.
    pub unresolved: Vec<Site<'a>>,
}

/// How a dead import by path reaches no declaration: its file exports none of the name read here.
pub(crate) const DEAD: &str = "a path that reaches no one declaration read here";
/// How an unresolved import by path reaches no declaration: where it leads is not known.
pub(crate) const UNRESOLVED: &str = "a path the source index resolved to no file";

/// The sentence over `count` imports of `name` by path, `how` they reach no declaration, that `symbol` and `uses` list apart.
pub(crate) fn stray_heading(name: &str, count: usize, how: &str) -> String {
    let import = if count == 1 { "imports" } else { "import" };
    format!("{count} more {import} `{name}` by {how}, so none is credited with them:")
}

/// One kind of import by path that reaches no declaration of the name read
/// here, `how` it reaches none, listed apart, each with its package, since none
/// is credited with them.
fn stray_sites(lines: &mut Vec<String>, asking: &Asking<'_>, mut sites: Vec<Site<'_>>, how: &str) {
    if sites.is_empty() { return }
    let &Asking { name, from, .. } = asking;
    let limit = asking.shown();
    asking.listed.borrow_mut().sites.extend(sites.iter().map(|site| (site.at.to_owned(), site.line)));
    sites.sort_by(|a, b| nearest(from, a.at, a.line, b.at, b.line));
    let heading = stray_heading(name, sites.len(), how);
    list(lines, asking, &heading, sites.iter().map(|site| site_line(site, name, false, limit)));
}

/// `uses` for a name only imports by path name, which no file here exports:
/// each import, with its package.
fn path_uses(asking: &Asking<'_>, paths: &[crate::help_symbol_rows::PathSite<'_>]) -> String {
    let sites: Vec<_> = paths.iter().map(|path| path.site).collect();
    let mut lines = vec![format!("`{}` is imported in {}, and no entry publishes it.", asking.name, places(sites.len())), order_line(asking)];
    list_kinds(&mut lines, asking, None, sites);
    lines.join("\n")
}

/// `strayed`: imports by path are listed apart below, so an export no site is credited to is still imported.
fn headline(asking: &Asking<'_>, kinds: &str, published: Option<&str>, exported: Option<(&str, Option<&str>)>, home: &str, sites: &[Site<'_>], strayed: bool) -> String {
    let name = asking.name;
    let named = if kinds.is_empty() { format!("`{name}`") } else { format!("`{name}` [{kinds}]") };
    if sites.is_empty() {
        if let Some((at, member)) = exported {
            let how = member.map_or_else(|| format!("exported, without being published, at {at}"), |member| format!("{member}, and exported at {at}"));
            let taken = if strayed { "no import read here is credited with it" } else { "nothing in this workspace imports it" };
            return format!("{named} is {how}, and {taken}; {UNCOUNTED}.");
        }
        let published = published.map_or_else(|| "published".into(), |at| format!("{at},"));
        return format!("{named} is {published} and nothing in this workspace imports it; {UNCOUNTED}. `{}` has its signature and what is written above it.", asking.surface.tool("symbol"));
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
        format!("{named} is imported in {}{}{which}{loaded}", places(count.certain), if home.is_empty() { String::new() } else { count.split(home) })
    };
    format!("{taken}{}", count.may_read(name))
}

fn places(count: usize) -> String {
    format!("{count} {}", if count == 1 { "place" } else { "places" })
}

pub(crate) struct Counts {
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

fn list_kinds(lines: &mut Vec<String>, asking: &Asking<'_>, home: Option<&str>, mut sites: Vec<Site<'_>>) {
    let &Asking { name, from, .. } = asking;
    let limit = asking.shown();
    asking.listed.borrow_mut().sites.extend(sites.iter().map(|site| (site.at.to_owned(), site.line)));
    sites.sort_by(|a, b| nearest(from, a.at, a.line, b.at, b.line));
    for (kind, heading) in [("story", "Stories"), ("test", "Tests"), ("source", "Source")] {
        let of = sites.iter().filter(|site| site.kind == kind);
        let Some(home) = home else {
            let rows: Vec<_> = of.collect();
            list(lines, asking, &format!("{heading}:"), rows.iter().map(|site| site_line(site, name, false, limit)));
            continue;
        };
        let (outside, inside): (Vec<_>, Vec<_>) = of.partition(|site| site.by != home);
        list(lines, asking, &format!("{heading}, from other packages:"), outside.iter().map(|site| site_line(site, name, false, limit)));
        list(lines, asking, &format!("{heading}, inside {home}:"), inside.iter().map(|site| site_line(site, name, true, limit)));
    }
}

fn list_own(lines: &mut Vec<String>, asking: &Asking<'_>, at: &str, does: &str, uses: &[InFile]) {
    let start = uses.partition_point(|site| code_unit(&site.at, at).is_lt());
    let group = &uses[start..];
    let end = group.partition_point(|site| site.at == at);
    if end == 0 { return }
    asking.listed.borrow_mut().sites.extend(group[..end].iter().map(|site| (site.at.clone(), site.line)));
    let by = &group[0].by;
    let who = if by.is_empty() { String::new() } else { format!(" — {by}") };
    list(lines, asking, &format!("Used in {at}{who}, which {does} it:"), group[..end].iter().map(|site| format!("  {}", site.line)));
}

fn list(lines: &mut Vec<String>, asking: &Asking<'_>, heading: &str, rows: impl ExactSizeIterator<Item = String>) {
    let limit = asking.shown();
    let count = rows.len();
    if count == 0 { return }
    lines.extend([String::new(), heading.to_owned(), String::new()]);
    lines.extend(rows.take(limit));
    if count > limit {
        lines.push(more_line(asking, count - limit));
    }
}

/// The line counting the `more` rows a list did not show.
fn more_line(asking: &Asking<'_>, more: usize) -> String {
    format!("… {more} more not shown; a higher `{}` shows them.", asking.surface.input("limit"))
}

fn site_line(site: &Site<'_>, name: &str, inside: bool, limit: usize) -> String {
    let mut text = format!("{}:{}", site.at, site.line);
    if !inside && !site.by.is_empty() { text.push_str(&format!(" — {}", site.by)); }
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
