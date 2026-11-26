//! Exact installed declarations and README excerpts from the native dependency catalogue.

// compass: variance-authority.report.agent-surface

use std::path::Path;

use crate::dependency_lexicon::query::{exact_dependencies, Match, Matches, Silent};
use crate::help_readme::mention_at;
use crate::help_surface::Surface;

/// The installed declarations of `name`, one block each, as the manifests
/// owning `from` resolve them when it names paths: there, or, when they
/// offer none and another manifest does, why not and where it is offered.
/// `None` inside when the catalogue is not published.
pub(super) fn blocks(root: &str, directory: &Path, name: &str, package: Option<&str>, from: &[String], limit: usize, surface: Surface<'_>) -> Option<Option<Vec<String>>> {
    let limit = u32::try_from(limit).unwrap_or(u32::MAX);
    let Some(everywhere) = exact_dependencies(directory, name, None, package, limit)? else {
        return Some(None);
    };
    let here = if from.is_empty() { None } else { exact_dependencies(directory, name, Some(from.to_vec()), package, limit)? };
    if let Some(here) = here.as_ref().filter(|here| here.total == 0 && everywhere.total > 0) {
        let owner = here.scope.location.as_ref().map_or_else(|| "the manifest that owns it".to_owned(), |location| location.join(", "));
        let mut blocks = vec![format!("`{name}` is not usable from {}: {owner} does not declare or import it. It is offered under:", from.join(", "))];
        blocks.extend(shown(&everywhere, surface)?);
        return Some(Some(blocks));
    }
    let matches = here.as_ref().unwrap_or(&everywhere);
    let mut blocks = shown(matches, surface)?;
    blocks.extend(silent(Path::new(root), name, &matches.silent, package.is_some())?);
    Some(Some(blocks))
}

/// One block per match shown, and the count of the rest.
fn shown(matches: &Matches, surface: Surface<'_>) -> Option<Vec<String>> {
    let mut blocks: Vec<_> = matches.shown.iter().map(installed).collect::<Option<_>>()?;
    let rest = matches.total as usize - blocks.len();
    if rest > 0 {
        let noun = if rest == 1 { "match" } else { "matches" };
        blocks.push(format!("{rest} more {noun} not shown; a higher `{}` shows them.", surface.input("limit")));
    }
    Some(blocks)
}

/// The installed declarations of `name` usable at `at` that `specifier` opens, one block each; `None` inside when there are none.
pub(crate) fn imported_from(directory: &Path, name: &str, at: &str, specifier: &str, package: Option<&str>) -> Option<Option<String>> {
    let Some(matches) = exact_dependencies(directory, name, Some(vec![at.to_owned()]), package, 100)? else { return Some(None) };
    let blocks: Vec<_> = matches.shown.iter().filter(|entry| entry.specifier == specifier).map(installed).collect::<Option<_>>()?;
    Some((!blocks.is_empty()).then(|| blocks.join("\n\n")))
}

fn installed(entry: &Match) -> Option<String> {
    let version = entry.version.as_ref().map_or_else(String::new, |version| format!("@{version}"));
    let declaration = entry.declaration_provider.as_ref().map_or_else(String::new, |provider| format!(" · declarations: {provider}"));
    let why = provenance(entry.version.as_deref(), entry.declared_as.as_deref(), &entry.manifest, entry.imports, entry.site.as_deref());
    let mut lines = vec![
        format!("{} · {} [{}] · {}{version}{declaration}", entry.specifier, entry.name, entry.kind, entry.package),
        why,
        format!("{}:{}", entry.at.as_deref()?, entry.line?),
    ];
    lines.extend(entry.signature.iter().chain(&entry.doc).cloned());
    Some(lines.join("\n"))
}

fn silent(root: &Path, name: &str, entries: &[Silent], named: bool) -> Option<Vec<String>> {
    let mut doors = Vec::<Vec<&Silent>>::new();
    let mut groups = std::collections::HashMap::new();
    for entry in entries {
        let key = (&entry.package, &entry.version, entry.readme.as_ref().map(|readme| &readme.at));
        let at = *groups.entry(key).or_insert_with(|| {
            doors.push(Vec::new());
            doors.len() - 1
        });
        doors[at].push(entry);
    }
    let mut blocks = Vec::new();
    for doors in doors {
        let one = doors[0];
        let readme = one.readme.as_ref();
        let passage = match readme {
            Some(readme) if readme.unreadable.is_none() => mention_at(root, &readme.at, name).ok()?,
            _ => None,
        };
        if !named && passage.is_none() { continue; }
        let version = one.version.as_ref().map_or_else(String::new, |version| format!("@{version}"));
        let mut lines: Vec<_> = doors.iter().map(|door| format!("{} · {}{version} — {}", door.specifier, door.package, door.reason)).collect();
        lines.push(match readme {
            None => "It ships no README.md beside its manifest.".to_owned(),
            Some(readme) => match &readme.unreadable {
                Some(why) => format!("{} could not be read: {why}", readme.at),
                None => format!("README: {} ({} lines)", readme.at, readme.lines.unwrap_or(0)),
            },
        });
        if let Some(passage) = passage {
            lines.extend([format!("{}:{} names `{name}`:", passage.at, passage.line), String::new(), passage.text]);
        }
        blocks.push(lines.join("\n"));
    }
    Some(blocks)
}

/// Where an installed dependency stands: its version, the manifest that
/// declares it, and how often the workspace imports it.
pub(crate) fn provenance(version: Option<&str>, declared: Option<&str>, manifest: &str, imports: Option<u32>, site: Option<&str>) -> String {
    let version = version.map_or_else(|| "version not resolved".into(), |version| format!("@{version}"));
    let declared = declared.map_or_else(|| format!("imported under {manifest}, not declared there"), |kind| format!("{kind} in {manifest}"));
    let used = match imports {
        None => "imports not indexed".into(),
        Some(0) => "not imported".into(),
        Some(count) => format!("imported {count}× (first {})", site.unwrap_or("site not recorded")),
    };
    format!("{version} · {declared} · {used}")
}
