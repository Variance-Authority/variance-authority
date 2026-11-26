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
use crate::help_surface::{Surface, Value};
use crate::help_symbol_published::{published_declarations, published_symbols};
use crate::help_declared_in::{heads, joined, publishing, rows_of, Readings};
use crate::help_path_landing::landing;
use crate::help_unread::{Said, STORE};
use crate::help_symbol_exported::{declaring, exported_only, imports_of};
use crate::help_uses_answer::{stray_heading, DEAD, UNRESOLVED};
use crate::help_symbol_rows::{Export, PathKind, PathSite, Rows};
use crate::help_unpublished::exports_named;
use crate::help_usage::requested;
use crate::read_any::{language_of, Language};

/// Declarations of a name shown when the question says no limit.
pub(crate) const DECLARED_CAP: usize = 5;

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
    /// The paths the question stands at: kept declarations nearest them first, installed ones as their manifests resolve them.
    pub from: &'q [String],
    pub limit: Option<usize>,
    pub surface: Surface<'q>,
}

/// One name's answer, and the files of the checkout it rests on.
pub(crate) struct SymbolAnswer {
    pub text: String,
    /// Whether anything, in the checkout or installed, declares the name.
    pub found: bool,
    /// The checkout's declarations of the name; `Err` saying so when no file of the checkout declares it.
    pub declared: Result<Declared, String>,
    /// Every file the answer rests on: each declaration, every export and
    /// binding, and each entry and barrel a published one is taught through;
    /// none when no file of the checkout declares or binds the name.
    pub rests_on: Option<Vec<String>>,
}

/// The files of the checkout that declare a name, each at its lines, every name each `file:line` is written by, and what was not read.
pub(crate) struct Declared {
    pub files: Vec<(String, Vec<u32>)>,
    pub spelled: Vec<(String, Vec<String>)>,
    /// For each of `spelled`, the last line of the head the index cut for it.
    pub heads: Vec<Option<u32>>,
    pub unread: Vec<String>,
}

/// Answer exact names in request order from the help store `store` and the
/// index layers `asking` carries; `Err` says why the answer did not read.
pub(crate) fn exact_symbols(asking: &Asking<'_>, store: &mut (impl Read + Seek), names: &[&str]) -> Result<Vec<SymbolAnswer>, String> {
    let wanted = asking.wanted;
    let mut rows = Rows::read(store).said(STORE)?;
    let mut entries = false;
    let mut paths = false;
    let mut renamed = Vec::with_capacity(names.len());
    for &name in names {
        let published = rows.published(name).said(STORE)?;
        let binds = aliases(asking.root, asking.layers, name);
        // An import that renames an export is answered by that export: its entry, or its file's export.
        entries |= !published.is_empty() || !binds.is_empty() || rows.publishes_declared(&rows.exported_beside(name).said(STORE)?).said(STORE)?;
        paths |= !rows.path_uses(name).said(STORE)?.is_empty();
        // A declaration published under another name is imported by path by the name it is declared by.
        for row in published {
            let declared = rows.string("pub.declared", row).said(STORE)?;
            paths |= declared != name && !rows.path_uses(declared).said(STORE)?.is_empty();
        }
        renamed.push(binds);
    }
    if entries { rows.read_entries(store).said(STORE)?; }
    // Which declaration an export is, and the name it is keyed by, is read off the export list.
    rows.read_exported(store).said(STORE)?;
    if paths {
        rows.read_paths(store).said(STORE)?;
    } else if wanted.is_some_and(|wanted| owner_of(wanted) != wanted) {
        rows.read_path_targets(store).said(STORE)?;
    }
    let package = PackageScope::read(&rows, wanted).said(STORE)?;
    names.iter().zip(renamed).map(|(name, binds)| exact_symbol(asking, &rows, name, binds, &package)).collect()
}

/// One name's answer, said with the files that only bind it, and the files it rests on.
fn exact_symbol(asking: &Asking<'_>, rows: &Rows, name: &str, binds: Vec<Alias>, package: &PackageScope<'_>) -> Result<SymbolAnswer, String> {
    let &Asking { root, lexicon, layers, from, limit: said_limit, surface, .. } = asking;
    let keys = Keys::new(root, layers, rows);
    let published = published_declarations(&keys, name, package)?;
    let mut paths = rows.path_uses(name).said(STORE)?.into_iter().map(|row| rows.path_site(row)).collect::<Option<Vec<_>>>().said(STORE)?;
    paths.retain(|site| package.path(site.specifier));
    // Asked for the slot, a file imported by path answers only when its default is one nothing names.
    if name == SLOT && published.is_empty() {
        let mut answering = Vec::with_capacity(paths.len());
        for site in paths { if site.to.map_or(Some(true), |to| keys.answers(to, SLOT, SLOT)).said(STORE)? { answering.push(site) } }
        paths = answering;
    }
    let exports = rows.exports(name).said(STORE)?;
    let in_package = exports.iter().filter(|export| package.export(export)).cloned().collect::<Vec<_>>();
    // Another binding exported by the name is another thing, said beside the published one; a door to it is that one.
    let mut exported = exports_named(&keys, name, package).said(STORE)?;
    exported.retain(|held| !published.iter().any(|one| one.at == held.key.at && one.declared == held.key.named));
    // A local name of a declaration answered above says it by its line, not again whole.
    let local = local_names(&keys, layers, lexicon, name, binds, package).said(STORE)?;
    let alias_files: Vec<_> = local.iter().flat_map(|one| one.files.iter().cloned()).collect();
    let above: HashSet<String> = published.iter().map(|one| format!("{}\0{}", one.at, one.declared))
        .chain(exported.iter().map(|held| format!("{}\0{}", held.key.at, held.key.named))).collect();
    let aliased: Vec<_> = local.into_iter().map(|one| match one.brief {
        Some((text, key)) if above.contains(&key) => text,
        _ => one.text,
    }).collect();
    let (container, member) = member_name(name);
    let members: Vec<_> = member_sites(root, layers, member).into_iter()
        .filter(|site| package.member(&site.by) && container.is_none_or(|on| site.on == on)).collect();
    let mut reading = declared(root, layers, name, Matching::Exact, None);
    reading.names.retain(|held| package.declared(&held.by) && can_keep(held));
    reading.names.sort_by_key(declaration_kind_order);
    // Nearest a start point first, source first among equals.
    if !from.is_empty() {
        reading.names.sort_by_key(|held| std::cmp::Reverse(from.iter().map(|at| shared_segments(at, &held.at)).max().unwrap_or(0)));
    }
    let groups = imports_of(root, layers, &exported).said(STORE)?;
    let paired: Vec<_> = exported.iter().zip(&groups).collect();
    let read = Readings { name, member, published: &published, paths: &paths, exports: &in_package, declared: &reading.names, members: &members };
    let own: Vec<_> = declaring(&paired).into_iter().map(|(held, _)| *held).collect();
    let declared_rows = rows_of(&read, rows, layers, &own, false, &alias_files).said(STORE)?;
    let joined_rows = (!declared_rows.is_empty()).then(|| {
        let (files, spelled) = joined(declared_rows);
        let heads = heads(&spelled, layers, &reading.names);
        (files, spelled, heads)
    });
    let every: Vec<_> = exported.iter().collect();
    let resting = rows_of(&read, rows, layers, &every, true, &alias_files).said(STORE)?;
    let mut blocks = Vec::new();
    let mut found = true;
    let mut through = Vec::new();
    if !published.is_empty() {
        let (said, passing) = published_symbols(&keys, root, layers, name, &published, &paths, package, surface).said(STORE)?;
        blocks.extend(said);
        through = passing;
        if !paired.is_empty() { blocks.push(exported_only(&keys, layers, name, &paired, false, surface).said(STORE)?); }
    } else if !paths.is_empty() {
        let ByPath { blocks: landed, covered, strays } = by_path(layers, rows, name, &in_package, paths, said_limit.unwrap_or(DECLARED_CAP), surface).said(STORE)?;
        blocks.extend(landed);
        let rest: Vec<_> = paired.iter().copied().filter(|(held, _)| !covered.contains(held.export.at)).collect();
        if !rest.is_empty() { blocks.push(exported_only(&keys, layers, name, &rest, !strays.is_empty(), surface).said(STORE)?); }
        blocks.extend(strays);
    }
    let workspace_door = !blocks.is_empty();
    if !workspace_door && !paired.is_empty() {
        blocks.push(exported_only(&keys, layers, name, &paired, false, surface).said(STORE)?);
    }
    // A file that only binds the name declares nothing: it follows every declaration.
    let (bound, kept): (Vec<_>, Vec<_>) = reading.names.into_iter().partition(|held| is_bound(&held.kind));
    let only_members = blocks.is_empty() && kept.is_empty() && aliased.is_empty();
    let limit = said_limit.unwrap_or(DECLARED_CAP);
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
        let dependencies = dependencies::blocks(root, lexicon, name, wanted, from, said_limit.unwrap_or(100), surface).said(STORE)?;
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
            let absence = container_absence(&keys, root, layers, name, package, limit, surface).said(STORE)?;
            blocks.push(nowhere(name, &rows.published_names().said(STORE)?, layers, &reading.unread, Some(&dependencies), wanted, package.export_hint(rows, name, &exports).said(STORE)?.as_deref(), absence, surface));
            found = false;
        }
    }
    blocks.extend(bindings);
    let text = blocks.join("\n\n");
    let rests_on = (!resting.is_empty()).then(|| {
        let mut files: Vec<_> = joined(resting).0.into_iter().map(|(file, _)| file).collect();
        files.extend(publishing(&published, &through));
        files
    });
    let declared = if let Some((files, spelled, heads)) = joined_rows {
        let mut unread: Vec<_> = unread_line(&reading.unread).into_iter().collect();
        unread.extend(member_stop(layers, member, if members.is_empty() { "there" } else { "there too" }));
        Ok(Declared { files, spelled, heads, unread })
    } else {
        let absence = container_absence(&keys, root, layers, name, package, limit, surface).said(STORE)?;
        Err(nowhere(name, &rows.published_names().said(STORE)?, layers, &reading.unread, None, package.wanted(), package.export_hint(rows, name, &exports).said(STORE)?.as_deref(), absence, surface))
    };
    Ok(SymbolAnswer { text, found, declared, rests_on })
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

/// How many leading path segments two paths share.
pub(crate) fn shared_segments(left: &str, right: &str) -> usize {
    left.split('/').zip(right.split('/')).take_while(|(a, b)| a == b).count()
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
pub(crate) fn nowhere(name: &str, published: &[&str], layers: &[crate::compact::Layer], unread: &[String], dependencies: Option<&str>, package: Option<&str>, exported: Option<&str>, container: Option<String>, surface: Surface<'_>) -> String {
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
    let stop = member_stop(layers, member_name(name).1, "there");
    let absence = container.unwrap_or_else(|| {
        let at_top = if stop.is_none() { ", at its top level or as a member." } else { " at its top level, and no JavaScript or TypeScript file declares it as a member." };
        format!("No file in {where_}{files} declares `{name}`{at_top}")
    });
    let mut blocks = vec![hint, absence];
    blocks.extend(dependencies.map(str::to_owned));
    blocks.extend(stop);
    blocks.push("A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.".to_owned());
    blocks.extend(unread_line(unread));
    blocks.join(" ")
}

/// For a dotted name, why no file is said to declare it: a member is declared
/// in its container's body, which is not always read, so a dotted name is
/// never said to be declared nowhere; `None` within for a name with no container.
#[allow(clippy::too_many_arguments)]
pub(crate) fn container_absence(keys: &Keys<'_>, root: &str, layers: &[Layer], name: &str, package: &PackageScope<'_>, limit: usize, surface: Surface<'_>) -> Option<Option<String>> {
    let (Some(on), member) = member_name(name) else { return Some(None) };
    // `Outer.Inner` is declared where `Outer` is: a file declares the name a path starts with.
    let head = on.split('.').next().unwrap_or(on);
    // Exported or kept to its file, a container is declared where a file binds it; an `export … from` binds nothing of its own.
    let mut containers: Vec<(String, u32)> = exports_named(keys, head, package)?.into_iter()
        .filter(|held| held.export.bound.is_some()).map(|held| (held.export.at.to_owned(), held.line)).collect();
    containers.extend(declared(root, layers, head, Matching::Exact, None).names.into_iter()
        .filter(|held| package.declared(&held.by) && held.holder_line.is_none() && !is_bound(&held.kind))
        .map(|held| (held.at, held.line)));
    let mut said = vec![if containers.is_empty() {
        format!("No file read here declares `{head}` at its top level; a namespace an import or an `export * as` binds is not read as one.")
    } else {
        let at = containers.iter().take(limit).map(|(at, line)| format!("{at}:{line}")).collect::<Vec<_>>().join(", ");
        format!("`{head}` is declared at {at}, and no interface, type alias or class body read here declares `{member}` on `{on}`.")
    }];
    if containers.len() > limit {
        let more = containers.len() - limit;
        let noun = if more == 1 { "declaration" } else { "declarations" };
        said.push(format!("{more} more {noun} of `{head}` not shown; a higher `{}` shows them.", surface.input("limit")));
    }
    let mut languages = Vec::new();
    for language in containers.iter().map(|(at, _)| language_of(at)) { if !languages.contains(&language) { languages.push(language) } }
    let checker = if languages.len() > 1 { "each declaration's own language server's" }
        else if languages.is_empty() || languages.contains(&Some(Language::Module)) { "TypeScript's language service's" }
        else { "its language server's" };
    said.push(format!("An inherited member is a type checker's answer, and none runs here; the source index reads no enum, namespace or object literal body: {checker} go-to-definition on `{name}` where a line writes it names the declaration."));
    Some(Some(said.join(" ")))
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

/// What the imports by path answer: one block per file they name or reach an
/// export of `name` in, the files covered, and, when the workspace exports the
/// name, the imports that reach none of its declarations, listed apart.
struct ByPath<'a> {
    blocks: Vec<String>,
    covered: HashSet<&'a str>,
    strays: Vec<String>,
}

/// The imports by path of `name`, as `ByPath` holds them: the first `limit` of each file's, and a count of the rest.
fn by_path<'a>(layers: &[crate::compact::Layer], rows: &Rows, name: &str, exports: &[Export<'a>], sites: Vec<PathSite<'a>>, limit: usize, surface: Surface<'_>) -> Option<ByPath<'a>> {
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
    let named: Vec<_> = exports.iter().filter(|export| export.name == name).collect();
    let mut covered = HashSet::new();
    let mut blocks = Vec::new();
    let (mut dead, mut unresolved) = (Vec::new(), Vec::new());
    for (file, group) in groups {
        let first = &group[0];
        let specifier = first.specifier;
        let (owner, _) = requested(specifier);
        let export = landing(layers, name, first, &named);
        // An import that reaches none of the name's declarations is no declaration's, so it gets no block of its own.
        if export.is_none() && !named.is_empty() {
            let into = if first.to.is_some() { &mut dead } else { &mut unresolved };
            into.extend(group.iter().map(path_line));
            continue;
        }
        if let Some(held) = export { covered.insert(held.at); }
        let bound = export.and_then(|held| declaration_exported(layers, held.at, held.name));
        // The question under a cut list names `--file` only for a declaration this answer reached; without one it asks by name alone.
        let declaring = bound.as_ref().map(|held| held.at.clone());
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
        lines.extend(group.iter().take(limit).map(path_line));
        if group.len() > limit {
            let mut asked = vec![("name", Value::Text(name))];
            if let Some(at) = &declaring { asked.push(("file", Value::Text(at))) }
            lines.push(more_imports(name, group.len() - limit, &surface.question("uses", &asked)));
        }
        covered.insert(file);
        blocks.push(lines.join("\n"));
    }
    let strays = [(dead, DEAD), (unresolved, UNRESOLVED)].into_iter().filter(|(sites, _)| !sites.is_empty()).map(|(sites, how)| {
        let mut said = vec![stray_heading(name, sites.len(), how)];
        said.extend(sites.iter().take(limit).cloned());
        if sites.len() > limit { said.push(more_imports(name, sites.len() - limit, &surface.question("uses", &[("name", Value::Text(name))]))) }
        said.join("\n")
    }).collect();
    Some(ByPath { blocks, covered, strays })
}

/// The line under a list of imports by path cut at the limit: how many more, and the question, `ask`, that lists them.
fn more_imports(name: &str, more: usize, ask: &str) -> String {
    format!("{more} more import{} of `{name}` not shown; {ask} lists them, nearest to a file you name first.", if more == 1 { "" } else { "s" })
}

/// One import by path, with its package and how it names the file.
fn path_line(site: &PathSite<'_>) -> String {
    let how = site.kind.how(site.specifier);
    let local = site.local.map_or_else(String::new, |local| format!(" (as {local})"));
    let typed = if site.site.type_only { " (type only)" } else { "" };
    let by = if site.site.by.is_empty() { String::new() } else { format!(" — {}", site.site.by) };
    format!("  {}:{}{by}{how}{local}{typed}", site.site.at, site.site.line)
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
