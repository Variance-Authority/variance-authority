//! One published entry or the imports that bypass it.

// compass: variance-authority.report.agent-surface

use super::*;
use crate::help_search_matches::opening;
use crate::text_cut::blank;
use regex::Regex;
use std::sync::LazyLock;

static WRAPPED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]*\n[ \t]*").expect("a fixed line break"));

pub(super) fn answer(file: &mut File, package: &str, subpath: Option<&str>) -> Option<Result<String, String>> {
    let rows = Rows::columns(
        file,
        [
            ("strings.blob", 1),
            ("strings.off", 4),
            ("pkg.name", 4),
            ("pkg.entry", 1),
            ("pkg.openOff", 4),
            ("open.subpath", 4),
            ("open.entryOff", 4),
            ("pub.usedByOff", 4),
            ("pub.doc", 4),
            ("deep.specifier", 4),
            ("deep.by", 4),
            ("deep.to", 4),
            ("deep.at", 4),
            ("deep.line", 4),
            ("deep.groups", 4),
            ("deep.namesOff", 4),
            ("use.name", 4),
            ("unreadable", 4),
            ("names.name", 4),
            ("pub.name", 4),
            ("pub.kind", 4),
            ("pub.uses", 4),
        ],
    )?;
    let surface = Surface(&rows);
    let subpath = subpath.filter(|path| !path.is_empty() && *path != ".");
    let asked = subpath
        .map_or_else(|| package.to_owned(), |path| format!("{package}{}", path.strip_prefix('.').unwrap_or(path)));
    let owner = owner_of(&asked);
    let owners =
        surface.packages().map(|row| Some((rows.string("pkg.name", row)?, row))).collect::<Option<Vec<_>>>()?;
    let published = owners.iter().find(|(name, _)| *name == owner).map(|(_, row)| *row);
    let imports = |group, exact: bool| imports_of(&surface, owner, exact.then_some(asked.as_str()), group);
    let by_path = imports(1, false)?;
    let no_entry = match published {
        Some(row) => !surface.declares(row)?,
        None => false,
    } || by_path.present;
    let unread = rows.column("unreadable").len();
    if no_entry {
        let heading = format!("{owner} declares no entry: no `exports`, `main`, `types` or `typings`.");
        let sites = if asked == owner {
            if by_path.rows.is_empty() {
                Sites::just(format!("{heading} No other package imports a file of it."))
            } else {
                let files = per_file(&surface, &by_path.rows)?;
                let names = files.iter().map(|file| file.names).sum();
                files_said(
                    format!(
                        "{heading} Other packages import {} by path, most imported first:",
                        counted(names, files.len())
                    ),
                    &files,
                    None,
                )?
            }
        } else {
            let asked_rows = by_path
                .rows
                .into_iter()
                .filter(|&row| rows.string("deep.specifier", row) == Some(asked.as_str()))
                .collect::<Vec<_>>();
            if asked_rows.is_empty() {
                Sites::just(format!("{heading} No other package imports {asked}."))
            } else {
                let names = by_name(&surface, &asked_rows, &asked)?;
                let total = count(names.named, "name");
                names.with_heading(format!(
                    "{heading} Other packages import {total} from {asked} by path, most imported first:"
                ))
            }
        };
        return Some(Ok(sites.finish(unread)));
    }

    if asked != owner {
        let naming = imports(2, true)?.rows;
        if !naming.is_empty() {
            let names = by_name(&surface, &naming, &asked)?;
            let who = plural(naming.len(), "import names", "imports name");
            let sites = names.with_heading(format!("{asked} is an entry {UNFOLLOWED}, so none of its names are listed. {who} it. By name, most imported first:"));
            return Some(Ok(sites.finish(unread)));
        }
        let deep = imports(0, true)?.rows;
        if !deep.is_empty() {
            let names = by_name(&surface, &deep, &asked)?;
            let sites =
                names.with_heading(format!("{}. By name, most imported first:", past_heading(deep.len(), owner)));
            return Some(Ok(sites.finish(unread)));
        }
    }

    if let Some(pkg) = published {
        let opened = rows.range("pkg.openOff", pkg)?;
        if opened.is_empty() {
            if asked != owner {
                return Some(Err(format!(
                    "`{asked}`: {owner} declares an entry {UNFOLLOWED}, and no other package imports this specifier"
                )));
            }
            if subpath.is_none() {
                let heading = format!("{owner} declares an entry {UNFOLLOWED}, so none of its names are listed.");
                let past = beyond(&surface, owner, imports(2, false)?.rows, imports(0, false)?.rows)?;
                if past.lines.is_empty() {
                    return Some(Ok(format!("{heading} No other package imports it.")));
                }
                let mut said = Sites::just(heading);
                said.append(past);
                return Some(Ok(said.finish(unread)));
            }
        } else if asked == owner && subpath.is_none() {
            let subpaths = opened.clone().map(|row| rows.string("open.subpath", row)).collect::<Option<Vec<_>>>()?;
            if !subpaths.contains(&".") {
                let opened = opened
                    .zip(subpaths)
                    .map(|(row, path)| surface.opening(row, owner, path))
                    .collect::<Option<Vec<_>>>()?;
                let door = most_used(&opened).or_else(|| opened.first())?;
                let mut said = Sites::just(format!("{owner} opens no main entry. It opens:"));
                said.lines.extend(opened.iter().map(|entry| format!("  {}", entry.line())));
                said.asks.push(ask_entry(&door.spec));
                let past = beyond(&surface, owner, imports(2, false)?.rows, imports(0, false)?.rows)?;
                let floor = if past.lines.is_empty() { 0 } else { unread };
                said.append(past);
                return Some(Ok(said.finish(floor)));
            }
        }
    }

    let named = owners.iter().find(|(name, _)| *name == package);
    let door = if named.is_some() || subpath.is_some() {
        named.map(|(name, row)| (*name, *row, subpath.unwrap_or(".").to_owned()))
    } else {
        owners
            .iter()
            .filter_map(|(name, row)| {
                let suffix = package.strip_prefix(name)?.strip_prefix('/')?;
                Some((*name, *row, format!("./{suffix}")))
            })
            .max_by_key(|(name, _, _)| name.len())
    };
    let Some((name, pkg, wanted)) = door else {
        let reason = if owners.is_empty() {
            NOTHING.to_owned()
        } else {
            format!("this workspace publishes: {}", owners.iter().map(|(name, _)| *name).collect::<Vec<_>>().join(", "))
        };
        return Some(Err(format!("unknown package `{package}`; {reason}")));
    };
    let mut known = Vec::new();
    let mut selected = None;
    for row in rows.range("pkg.openOff", pkg)? {
        let path = rows.string("open.subpath", row)?;
        if selected.is_none() && path == wanted {
            selected = Some(row);
        }
        known.push(path);
    }
    let Some(row) = selected else {
        return Some(Err(format!("`{name}` does not open `{wanted}`; it opens: {}", known.join(", "))));
    };
    let entry = surface.opening(row, name, &wanted)?;
    let mut said = if entry.names == 0 {
        Sites::just(format!("{} opens no names.", entry.spec))
    } else {
        let mut names = Sites::just(format!("{} — {}", entry.spec, count(entry.names, "name")));
        names.lines.push(String::new());
        for row in rows.range("open.entryOff", entry.row)? {
            names.lines.push(entry_line(&rows, row)?);
        }
        names
    };
    let floor = if subpath.is_none() && package == name {
        let past = beyond(&surface, owner, imports(2, false)?.rows, imports(0, false)?.rows)?;
        let floor = if past.lines.is_empty() { 0 } else { unread };
        said.append(past);
        floor
    } else {
        0
    };
    Some(Ok(said.finish(floor)))
}

fn entry_line(rows: &Rows, row: usize) -> Option<String> {
    let name = rows.string("names.name", rows.number("pub.name", row)? as usize)?;
    let kind = rows.string("pub.kind", row)?;
    let uses = rows.number("pub.uses", row)? as usize;
    let read = if uses == 0 {
        "no other package imports it by its published path".to_owned()
    } else {
        format!(
            "{} by published path from {}",
            count(uses, "import"),
            count(rows.range("pub.usedByOff", row)?.len(), "other package")
        )
    };
    let doc = rows.optional("pub.doc", row)?.map_or_else(
        || "UNDOCUMENTED".into(),
        |doc| WRAPPED.replace_all(opening(doc), " ").trim_matches(blank).to_owned(),
    );
    Some(format!("{name} [{kind}] {read} — {doc}"))
}

struct Imports {
    present: bool,
    rows: Vec<usize>,
}

fn imports_of(surface: &Surface<'_>, owner: &str, exact: Option<&str>, group: usize) -> Option<Imports> {
    let mut found = Imports { present: false, rows: Vec::new() };
    for row in surface.group(group)? {
        let spec = surface.0.string("deep.specifier", row)?;
        if owner_of(spec) != owner || exact.is_some_and(|asked| asked != spec) {
            continue;
        }
        found.present = true;
        if surface.0.string("deep.by", row)? != owner {
            found.rows.push(row);
        }
    }
    if group != 1 {
        let mut keyed = found
            .rows
            .into_iter()
            .map(|row| {
                Some((
                    surface.0.string("deep.specifier", row)?,
                    surface.0.string("deep.at", row)?,
                    surface.0.number("deep.line", row)?,
                    row,
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        keyed.sort_by(|a, b| code_unit(a.0, b.0).then_with(|| code_unit(a.1, b.1)).then(a.2.cmp(&b.2)));
        found.rows = keyed.into_iter().map(|(_, _, _, row)| row).collect();
    }
    Some(found)
}

#[derive(Default)]
struct Sites {
    lines: Vec<String>,
    asks: Vec<String>,
}

impl Sites {
    fn just(line: String) -> Self {
        Self { lines: vec![line], asks: Vec::new() }
    }

    fn append(&mut self, next: Self) {
        if next.lines.is_empty() {
            return;
        }
        if !self.lines.is_empty() {
            self.lines.push(String::new());
        }
        self.lines.extend(next.lines);
        self.asks.extend(next.asks);
    }

    fn finish(mut self, unread: usize) -> String {
        if unread > 0 {
            block(
                &mut self.lines,
                format!(
                    "{} could not be read, so these imports are a floor; `variance ask packages` lists {}.",
                    count(unread, "file"),
                    if unread == 1 { "it" } else { "them" }
                ),
                [],
            );
        }
        narrower(&mut self.lines, self.asks);
        self.lines.join("\n")
    }
}

fn uses_of(name: &str, spec: &str) -> String {
    format!("variance ask uses --name {} --package {}", shell(name), shell(spec))
}

fn past_heading(imports: usize, owner: &str) -> String {
    format!("{} past a published entrypoint of {owner}. {REACHING}", plural(imports, "import reaches", "imports reach"))
}

fn beyond(surface: &Surface<'_>, owner: &str, naming: Vec<usize>, deep: Vec<usize>) -> Option<Sites> {
    let mut found = Sites::default();
    if !naming.is_empty() {
        let files = per_file(surface, &naming)?;
        let heading = format!(
            "{} an entry {owner} declares that this reading could not follow, most imported first:",
            plural(naming.len(), "import names", "imports name")
        );
        found.append(files_said(heading, &files, Some(owner))?);
    }
    if !deep.is_empty() {
        let files = per_file(surface, &deep)?;
        found.append(files_said(
            format!("{}. By file, most imported first:", past_heading(deep.len(), owner)),
            &files,
            None,
        )?);
    }
    Some(found)
}

struct Names {
    named: usize,
    sites: Sites,
}

impl Names {
    fn with_heading(mut self, heading: String) -> Sites {
        self.sites.lines.insert(0, heading);
        self.sites
    }
}

fn by_name(surface: &Surface<'_>, imports: &[usize], spec: &str) -> Option<Names> {
    let mut names = HashMap::<&str, HashSet<&str>>::new();
    let mut whole = HashSet::new();
    for &row in imports {
        let importer = surface.0.string("deep.at", row)?;
        let named = surface.each_name(row, |name| {
            names.entry(name).or_default().insert(importer);
        })?;
        if !named {
            whole.insert(importer);
        }
    }
    let ranked = ordered(names, HashSet::len);
    let named = ranked.len();
    let asks = ranked.first().map(|(name, _)| uses_of(name, spec)).into_iter().collect();
    let mut lines: Vec<_> =
        ranked.iter().map(|(name, files)| format!("  {name} — imported by {}", count(files.len(), "file"))).collect();
    if !whole.is_empty() {
        let at = ranked.partition_point(|(_, files)| files.len() >= whole.len());
        lines.insert(at, format!("  the whole module, no name read — imported by {}", count(whole.len(), "file")));
    }
    Some(Names { named, sites: Sites { lines, asks } })
}

struct Taken<'a> {
    specifiers: Vec<&'a str>,
    names: usize,
    importers: usize,
    first_name: Option<&'a str>,
}

fn per_file<'a>(surface: &Surface<'a>, imports: &[usize]) -> Option<Vec<Taken<'a>>> {
    let mut positions = HashMap::<&str, usize>::new();
    let mut by_file: Vec<Vec<usize>> = Vec::new();
    for &row in imports {
        let spec = surface.0.string("deep.specifier", row)?;
        let path = surface.0.optional("deep.to", row)?.unwrap_or(spec);
        let at = *positions.entry(path).or_insert_with(|| {
            by_file.push(Vec::new());
            by_file.len() - 1
        });
        by_file[at].push(row);
    }
    let mut files = Vec::new();
    for group in by_file {
        let (mut importers, mut names) = (HashSet::new(), HashSet::new());
        let mut by_spec = HashMap::<&str, HashSet<&str>>::new();
        let mut by_name = HashMap::<(&str, &str), HashSet<&str>>::new();
        for row in group {
            let spec = surface.0.string("deep.specifier", row)?;
            let importer = surface.0.string("deep.at", row)?;
            importers.insert(importer);
            by_spec.entry(spec).or_default().insert(importer);
            surface.each_name(row, |name| {
                names.insert(name);
                by_name.entry((spec, name)).or_default().insert(importer);
            })?;
        }
        let specifiers: Vec<_> = ordered(by_spec, HashSet::len).into_iter().map(|(spec, _)| spec).collect();
        let first = *specifiers.first()?;
        let first_name = by_name
            .iter()
            .filter(|((spec, _), _)| *spec == first)
            .min_by(|((_, a), left), ((_, b), right)| right.len().cmp(&left.len()).then_with(|| code_unit(a, b)))
            .map(|((_, name), _)| *name);
        files.push(Taken { specifiers, names: names.len(), importers: importers.len(), first_name });
    }
    files.sort_by(|a, b| {
        b.importers
            .cmp(&a.importers)
            .then(b.names.cmp(&a.names))
            .then_with(|| code_unit(a.specifiers[0], b.specifiers[0]))
    });
    Some(files)
}

fn files_said(heading: String, files: &[Taken<'_>], owner: Option<&str>) -> Option<Sites> {
    let first = files.first()?;
    let spec = *first.specifiers.first()?;
    let mut said = Sites::just(heading);
    said.lines.extend(files.iter().map(|file| {
        format!(
            "  {} — {}, imported by {}",
            file.specifiers.join(", "),
            count(file.names, "name"),
            count(file.importers, "file")
        )
    }));
    if Some(spec) != owner {
        said.asks.push(ask_entry(spec));
    }
    if let Some(name) = first.first_name {
        said.asks.push(uses_of(name, spec));
    }
    Some(said)
}
