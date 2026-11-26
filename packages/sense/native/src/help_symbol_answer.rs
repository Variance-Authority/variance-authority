//! Exact declarations and the workspace rows that can give the same name another answer.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek};
use std::path::Path;

use crate::compact::Layer;
use crate::harvest::is_bound;
use crate::help_aliases::{aliases, Alias};
use crate::help_key::{can_keep, Keys, SLOT};
use crate::help_local_names::local_names;
use crate::help_declared::{declared, DeclaredName, Matching};
use crate::help_members::{indexed_extensions, member_sites};
use crate::help_name_scope::{owner_of, PackageScope};
use crate::help_origin::declaration_exported;
use crate::help_surface::Surface;
use crate::help_symbol_published::{published_declarations, published_symbols};
use crate::help_symbol_exported::exported_only;
use crate::help_symbol_rows::{Export, PathKind, PathSite, Rows};
use crate::help_unpublished::exports_named;
use crate::help_usage::requested;
use crate::read_any::{language_of, Language};

#[path = "help_symbol_dependencies.rs"]
pub(crate) mod dependencies;

/// One `symbol` question: the checkout, the folder holding the dependency
/// catalogue and the index layers it reads, how its answer is narrowed and
/// cut, and the surface whose spelling it is said in.
pub(crate) struct Asking<'q> {
    pub root: &'q str,
    pub lexicon: &'q Path,
    pub layers: &'q [Layer<'q>],
    pub wanted: Option<&'q str>,
    pub limit: Option<usize>,
    pub surface: Surface<'q>,
}

/// Answer exact names in request order from the help store `store` and the
/// index layers `asking` carries, each `Err` when the answer is that nothing
/// declares it; `None` hands the question to the full reading.
pub(crate) fn exact_symbols(asking: &Asking<'_>, store: &mut (impl Read + Seek), names: &[&str]) -> Option<Vec<Result<String, String>>> {
    let wanted = asking.wanted;
    let mut rows = Rows::read(store)?;
    let mut entries = false;
    let mut paths = false;
    let mut renamed = Vec::with_capacity(names.len());
    for &name in names {
        let published = rows.published(name)?;
        let binds = aliases(asking.root, asking.layers, name);
        // An import that renames an export is answered by that export: its entry, or its file's export.
        entries |= !published.is_empty() || !binds.is_empty() || rows.publishes_declared(&rows.exported_beside(name)?)?;
        paths |= !rows.path_uses(name)?.is_empty();
        // A declaration published under another name is imported by path by the name it is declared by.
        for row in published {
            let declared = rows.string("pub.declared", row)?;
            paths |= declared != name && !rows.path_uses(declared)?.is_empty();
        }
        renamed.push(binds);
    }
    if entries { rows.read_entries(store)?; }
    // Which declaration an export is, and the name it is keyed by, is read off the export list.
    rows.read_exported(store)?;
    if paths {
        rows.read_paths(store)?;
    } else if wanted.is_some_and(|wanted| owner_of(wanted) != wanted) {
        rows.read_path_targets(store)?;
    }
    let package = PackageScope::read(&rows, wanted)?;
    names.iter().zip(renamed).map(|(name, binds)| exact_symbol(asking, &rows, name, binds, &package)).collect()
}

/// One name's answer: `Err` when it is that nothing declares the name, said
/// with the files that only bind it.
fn exact_symbol(asking: &Asking<'_>, rows: &Rows, name: &str, binds: Vec<Alias>, package: &PackageScope<'_>) -> Option<Result<String, String>> {
    let &Asking { root, lexicon, layers, limit: said_limit, surface, .. } = asking;
    let keys = Keys::new(root, layers, rows);
    let published = published_declarations(&keys, name, package)?;
    let mut paths = rows.path_uses(name)?.into_iter().map(|row| rows.path_site(row)).collect::<Option<Vec<_>>>()?;
    paths.retain(|site| package.path(site.specifier));
    // Asked for the slot, a file imported by path answers only when its default is one nothing names.
    if name == SLOT && published.is_empty() {
        let mut answering = Vec::with_capacity(paths.len());
        for site in paths { if site.to.map_or(Some(true), |to| keys.answers(to, SLOT, SLOT))? { answering.push(site) } }
        paths = answering;
    }
    let exports = rows.exports(name)?;
    let in_package = exports.iter().filter(|export| package.export(export)).cloned().collect::<Vec<_>>();
    // Another binding exported by the name is another thing, said beside the published one; a door to it is that one.
    let mut exported = exports_named(&keys, name, package)?;
    exported.retain(|held| !published.iter().any(|one| one.at == held.key.at && one.declared == held.key.named));
    // A local name of a declaration answered above says it by its line, not again whole.
    let local = local_names(&keys, layers, lexicon, name, binds, package)?;
    let above: HashSet<String> = published.iter().map(|one| format!("{}\0{}", one.at, one.declared))
        .chain(exported.iter().map(|held| format!("{}\0{}", held.key.at, held.key.named))).collect();
    let aliased: Vec<_> = local.into_iter().map(|one| match one.brief {
        Some((text, key)) if above.contains(&key) => text,
        _ => one.text,
    }).collect();
    let (container, member) = member_name(name);
    let members: Vec<_> = member_sites(root, layers, member).into_iter()
        .filter(|site| package.member(&site.by) && container.is_none_or(|on| site.on == on)).collect();
    if container.is_some() && members.is_empty() { return None }
    let mut blocks = Vec::new();
    let mut found = true;
    if !published.is_empty() {
        blocks.extend(published_symbols(&keys, root, layers, name, published, &paths, package, surface)?);
        if !exported.is_empty() { blocks.push(exported_only(&keys, root, layers, name, &exported.iter().collect::<Vec<_>>(), surface)?); }
    } else if !paths.is_empty() {
        let (by_path, imported) = by_path(layers, rows, name, &in_package, paths)?;
        blocks.extend(by_path);
        let rest: Vec<_> = exported.iter().filter(|held| !imported.contains(held.export.at)).collect();
        if !rest.is_empty() { blocks.push(exported_only(&keys, root, layers, name, &rest, surface)?); }
    }
    let workspace_door = !blocks.is_empty();
    if !workspace_door && !exported.is_empty() {
        blocks.push(exported_only(&keys, root, layers, name, &exported.iter().collect::<Vec<_>>(), surface)?);
    }
    let mut reading = declared(root, layers, name, Matching::Exact, None);
    reading.names.retain(|held| package.declared(&held.by) && can_keep(held));
    reading.names.sort_by_key(declaration_kind_order);
    // A file that only binds the name declares nothing: it follows every declaration.
    let (bound, kept): (Vec<_>, Vec<_>) = reading.names.into_iter().partition(|held| is_bound(&held.kind));
    let only_members = blocks.is_empty() && kept.is_empty() && aliased.is_empty();
    let limit = said_limit.unwrap_or(5);
    let bindings = listed(&bound, name, limit, "binding", surface);
    blocks.extend(listed(&kept, name, limit, "declaration", surface));
    if !kept.is_empty() { blocks.extend(unread_line(&reading.unread)); }
    blocks.extend(aliased);
    if !members.is_empty() {
        blocks.extend(members.iter().take(limit).map(|site| {
            let container = match site.on.as_str() {
                "a type literal" | "a class" => site.on.clone(),
                on => format!("`{on}`"),
            };
            format!("{name}\na member of {container}, declared at {}:{}\n`{}` names the lines that use it through a value written as its container, and the declaration to ask its language's find-references about for the rest.", site.at, site.line, surface.tool("uses"))
        }));
        if members.len() > limit {
            let more = members.len() - limit;
            let noun = if more == 1 { "member declaration" } else { "member declarations" };
            blocks.push(format!("{more} more {noun} of `{name}` not shown; a higher `{}` shows them.", surface.input("limit")));
        }
        blocks.extend(member_stop(layers, member, "there too"));
        if only_members { blocks.extend(unread_line(&reading.unread)); }
    }
    if !workspace_door {
        let wanted = package.wanted();
        let dependencies = dependencies::blocks(root, lexicon, name, wanted, said_limit.unwrap_or(100), surface)?;
        if let Some(found) = dependencies.as_ref().filter(|found| !found.is_empty()) {
            let no_local = blocks.is_empty();
            blocks.extend(found.iter().cloned());
            if no_local { blocks.extend(unread_line(&reading.unread)); }
        } else if blocks.is_empty() {
            let dependencies = if dependencies.is_some() {
                let named = wanted.map_or_else(String::new, |wanted| format!(" named `{wanted}`"));
                format!("No installed dependency{named} publishes it either.")
            } else {
                "Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and the `variance index` command publishes it.".to_owned()
            };
            blocks.push(nowhere(name, &rows.published_names()?, layers, &reading.unread, Some(&dependencies), wanted, package.export_hint(rows, name, &exports)?.as_deref(), surface));
            found = false;
        }
    }
    blocks.extend(bindings);
    let text = blocks.join("\n\n");
    Some(if found { Ok(text) } else { Err(text) })
}

/// What a file does with a name it does not export, as every answer about the name says it.
pub(crate) fn kept_as(held: &DeclaredName) -> &'static str {
    if is_bound(&held.kind) { "bound, not declared" } else { "declared, not exported" }
}

/// The blocks of the first `limit` rows, and the count of the `noun`s past them.
fn listed(rows: &[DeclaredName], name: &str, limit: usize, noun: &str, surface: Surface<'_>) -> Vec<String> {
    let mut blocks: Vec<_> = rows.iter().take(limit).map(block).collect();
    if rows.len() > limit {
        let more = rows.len() - limit;
        let plural = if more == 1 { "" } else { "s" };
        blocks.push(format!("{more} more {noun}{plural} of `{name}` not shown; a higher `{}` shows them.", surface.input("limit")));
    }
    blocks
}

pub(crate) fn declaration_kind_order(name: &DeclaredName) -> u8 {
    match name.file_kind.as_str() {
        "source" => 0,
        "test" => 1,
        _ => 2,
    }
}

pub(crate) fn unread_line(unread: &[String]) -> Option<String> {
    let count = unread.len();
    (count > 0).then(|| {
        let noun = if count == 1 { "file" } else { "files" };
        let named = unread[..count.min(3)].join(", ");
        let rest = if count > 3 { format!(" and {} more", count - 3) } else { String::new() };
        format!("The declarations of {count} {noun} were not read into the source index, so a name declared there is not known: {named}{rest}.")
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn nowhere(name: &str, published: &[&str], layers: &[crate::compact::Layer], unread: &[String], dependencies: Option<&str>, package: Option<&str>, exported: Option<&str>, surface: Surface<'_>) -> String {
    let search = surface.tool("search");
    let lowered = name.to_lowercase();
    let alike = published.iter().filter(|held| held.to_lowercase() == lowered && **held != name)
        .map(|held| format!("`{held}`")).collect::<Vec<_>>();
    let around = published.iter().filter(|held| held.to_lowercase().contains(&lowered)).count();
    let where_ = package.map_or_else(|| "this workspace".to_owned(), |package| format!("`{package}`"));
    let not_published = format!("`{name}` is not published by {where_}");
    let hint = match alike.as_slice() {
        [] if exported.is_some() => format!("{not_published}; {}", exported.unwrap_or_default()),
        [] if around == 0 => format!("{not_published}, and no published name contains it; ask `{search}` with a word from its documentation."),
        [] => {
            let contains = if around == 1 { "name contains" } else { "names contain" };
            format!("{not_published}; {around} published {contains} it — ask `{search}` with it as the `{}`.", surface.input("query"))
        }
        [one] => format!("{not_published}; {one} is. Names are matched exactly."),
        many => format!("{not_published}; {} are. Names are matched exactly.", many.join(" and ")),
    };
    let files = if unread.is_empty() { "" } else { " that the source index read" };
    let mut absence = format!("No file in {where_}{files} declares `{name}`");
    let stop = member_stop(layers, name, "there");
    absence.push_str(if stop.is_none() { ", at its top level or as a member." } else { " at its top level, and no JavaScript or TypeScript file declares it as a member." });
    let mut blocks = vec![hint, absence];
    blocks.extend(dependencies.map(str::to_owned));
    blocks.extend(stop);
    blocks.push("A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.".to_owned());
    blocks.extend(unread_line(unread));
    blocks.join(" ")
}

pub(crate) fn member_name(name: &str) -> (Option<&str>, &str) {
    static IDENTIFIER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"\A[\p{ID_Start}$_][\p{ID_Continue}$\u{200C}\u{200D}]*\z").expect("valid identifier pattern")
    });
    match name.rsplit_once('.') {
        Some((on, member)) if name.split('.').all(|part| IDENTIFIER.is_match(part)) => (Some(on), member),
        _ => (None, name),
    }
}

pub(crate) fn member_stop(layers: &[Layer], member: &str, where_: &str) -> Option<String> {
    let extensions = indexed_extensions(layers);
    let other = [(Language::Python, "Python"), (Language::Rust, "Rust"), (Language::Java, "Java"), (Language::Kotlin, "Kotlin"), (Language::Swift, "Swift")]
        .into_iter().filter(|(language, _)| extensions.iter().any(|extension| language_of(extension) == Some(*language)))
        .map(|(_, name)| name).collect::<Vec<_>>();
    let (last, earlier) = other.split_last()?;
    let languages = if earlier.is_empty() { (*last).to_owned() } else { format!("{} and {last}", earlier.join(", ")) };
    Some(format!("Members are read from JavaScript and TypeScript files only, and this workspace's {languages} files were not read for them: if `{member}` is a member {where_}, ask their language server's workspace symbols for it, then its find-references on the declaration."))
}

/// One block per file the imports by path name, and every file they name or reach an export of `name` in.
fn by_path<'a>(layers: &[crate::compact::Layer], rows: &Rows, name: &str, exports: &[Export<'a>], sites: Vec<PathSite<'a>>) -> Option<(Vec<String>, HashSet<&'a str>)> {
    let mut groups: Vec<(&str, Vec<PathSite<'_>>)> = Vec::new();
    let mut positions = HashMap::new();
    for site in sites {
        let file = site.to.unwrap_or(site.specifier);
        let at = *positions.entry(file).or_insert_with(|| {
            let at = groups.len();
            groups.push((file, Vec::new()));
            at
        });
        groups[at].1.push(site);
    }
    let mut covered = HashSet::new();
    let mut blocks = Vec::new();
    for (file, group) in groups {
        let first = &group[0];
        let specifier = first.specifier;
        let (owner, _) = requested(specifier);
        let mut matching = exports.iter().filter(|export| export.name == name && match first.to {
            Some(at) => export.at == at,
            None => export.by == owner,
        });
        let export = matching.next().filter(|_| first.to.is_some() || matching.next().is_none());
        if let Some(held) = export { covered.insert(held.at); }
        let bound = export.and_then(|held| declaration_exported(layers, held.at, held.name));
        let mut lines = vec![bound.as_ref().map_or_else(|| name.to_owned(), |held| format!("{name} [{}]", held.kind))];
        // The slot names nothing an import can bind by.
        if name != SLOT { lines.push(format!("import {{ {name} }} from '{specifier}';")) }
        if let Some(held) = &bound {
            lines.push(format!("declared at {}:{}", held.at, held.line));
        } else if let Some(held) = export {
            lines.push(format!("declared at {}:{}", held.at, rows.export_line(held)?));
        }
        let why = match first.kind {
            PathKind::Deep => format!("not published: {owner} declares an entry, and this file is not behind it."),
            PathKind::ByPath => format!("not published: {owner} declares no entry, so every import of it names a file."),
            PathKind::Unfollowed => format!("not listed: {owner} declares {specifier} as an entry, and this reading could not follow it to a source file."),
        };
        lines.push(why);
        if let Some(held) = bound { lines.extend(held.signature.into_iter().chain(held.doc)); }
        let noun = if group.len() == 1 { "place" } else { "places" };
        lines.push(format!("\nImported by path in {} {noun}:", group.len()));
        for site in group {
            let how = site.kind.how(site.specifier);
            let local = site.local.map_or_else(String::new, |local| format!(" (as {local})"));
            let typed = if site.site.type_only { " (type only)" } else { "" };
            lines.push(format!("  {}:{} — {}{how}{local}{typed}", site.site.at, site.site.line, site.site.by));
        }
        covered.insert(file);
        blocks.push(lines.join("\n"));
    }
    Some((blocks, covered))
}

fn block(held: &DeclaredName) -> String {
    let by = if held.by.is_empty() { String::new() } else { format!(" by {}", held.by) };
    let mut lines = vec![format!("{} [{}]", held.name, held.kind), format!("{}, at {}:{}{by}", kept_as(held), held.at, held.line)];
    lines.extend(held.signature.iter().chain(&held.doc).cloned());
    let reach = if let Some(line) = held.holder_line {
        let who = held.holder.as_ref().map_or_else(|| format!("the function written at {}:{line}", held.at), |name| format!("`{name}`"));
        let inside = if held.holder.is_some() { who.as_str() } else { "that function" };
        format!("Only {who} can name it: it is declared inside {inside}.")
    } else {
        match held.reach.as_deref() {
            Some("file") => format!("Nothing outside {} can import it: no export of that file names it.", held.at),
            Some("module") => "Only the module it is declared in, and the modules inside that one, can name it: it is not `pub`.".into(),
            Some("underscore" | "all") => {
                let by = if held.reach.as_deref() == Some("underscore") { "a leading underscore" } else { "`__all__`" };
                format!("Another module can still import it by name: {by} keeps it out of `from … import *` only.")
            }
            _ => "Who can reach it is not recorded: its reader cannot tell how this file hands it out.".into(),
        }
    };
    lines.push(reach);
    lines.join("\n")
}
