//! Exact installed declarations and README excerpts from the native dependency catalogue.

// compass: variance-authority.report.agent-surface

use std::path::Path;

use crate::dependency_lexicon::query::{exact_dependencies, Match, Silent};
use crate::help_readme::mention_at;
use crate::help_search_dependencies::provenance;

pub(super) fn blocks(root: &str, directory: &Path, name: &str, package: Option<&str>, limit: usize) -> Option<Option<Vec<String>>> {
    let Some(matches) = exact_dependencies(directory, name, package, u32::try_from(limit).unwrap_or(u32::MAX))? else {
        return Some(None);
    };
    let mut blocks: Vec<_> = matches.shown.iter().map(installed).collect::<Option<_>>()?;
    let rest = matches.total as usize - blocks.len();
    if rest > 0 {
        let noun = if rest == 1 { "match" } else { "matches" };
        blocks.push(format!("{rest} more {noun} not shown; a higher `--limit` shows them."));
    }
    blocks.extend(silent(Path::new(root), name, &matches.silent, package.is_some())?);
    Some(Some(blocks))
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
