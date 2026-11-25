//! The installed names and package descriptions shown beside source search.

// compass: variance-authority.report.agent-surface

use crate::dependency_lexicon::query::Matches;
use crate::help_grep_answer::Scope;
use crate::help_search_answer::section;
use crate::help_surface::{CLI, Value, typed};

pub(crate) fn lines(answer: &mut Vec<String>, query: &str, lowered: &str, scope: Option<&Scope>, limit: Option<usize>, matches: Option<&Matches>, own: bool) {
    let Some(matches) = matches else {
        answer.extend([String::new(), "Dependency lexicon not published; run `variance index` to prepare it.".into()]);
        return;
    };
    let all = |total: usize| in_full(query, scope, total);
    let total = matches.total as usize;
    if total == 0 && !own {
        let searched = if matches.scope.packages == 0 {
            "No dependency was searched: no manifest in reach declares or imports one.".into()
        } else {
            let count = matches.scope.packages;
            let hosts = &matches.scope.owners;
            let mut where_ = hosts[..hosts.len().min(3)].join(", ");
            if hosts.len() > 3 { where_.push_str(&format!(" and {} more", hosts.len() - 3)); }
            format!("Third-party names searched: {count} {} under {where_}.", if count == 1 { "package" } else { "packages" })
        };
        answer.extend([String::new(), format!("No third-party name matches `{lowered}`. {searched}")]);
    }
    if total != 0 {
        let noun = if total == 1 { "name matches" } else { "names match" };
        let head = format!("{total} third-party {noun} `{lowered}`");
        if own {
            let rows = matches.shown.iter().map(|one| format!("{} · {}", one.specifier, one.name));
            compact(answer, head, total, limit, rows, &all);
        } else {
            let offered = if scope.is_none() { "offered by some manifest in this workspace" } else { "usable from that start point, under the manifest that owns it" };
            section(answer, format!("{head}, {offered}:"), total, matches.shown.iter().map(|one| {
                let why = provenance(one.version.as_deref(), one.declared_as.as_deref(), &one.manifest, one.imports, one.site.as_deref());
                let says = one.summary.as_deref().unwrap_or("UNDOCUMENTED");
                format!("{} · {} [{}] {why} — {says}", one.specifier, one.name, one.kind)
            }));
        }
    }
    if let Some(why) = &matches.described_unread {
        answer.extend([String::new(), format!("{why}, so no package was asked whether it describes `{lowered}`; `variance index` rebuilds it.")]);
        return;
    }
    let described = matches.described.as_deref().unwrap_or_default();
    if described.is_empty() { return }
    let total = matches.described_total.map_or(described.len(), |count| count as usize);
    let noun = if total == 1 { "package describes" } else { "packages describe" };
    let head = format!("{total} {noun} `{lowered}`");
    if own {
        compact(answer, head, total, limit, described.iter().map(|one| one.specifier.clone()), &all);
    } else {
        section(answer, format!("{head} in their own words or the words of their names, best first:"), total, described.iter().map(|one| {
            let why = provenance(one.version.as_deref(), one.declared_as.as_deref(), &one.manifest, one.imports, one.site.as_deref());
            let says = one.description.as_deref().unwrap_or("no description published");
            let says = if says.encode_utf16().count() > 140 {
                format!("{}...", String::from_utf16_lossy(&says.encode_utf16().take(137).collect::<Vec<_>>()))
            } else { says.to_owned() };
            format!("{} {why} — {says} [holds: {}]", one.specifier, one.words.join(", "))
        }));
    }
}

/// The question that lists `total` names in full, from every start point the search had: a path to a flag, as `search` reads them.
fn in_full(query: &str, scope: Option<&Scope>, total: usize) -> String {
    let limit = total.max(20).to_string();
    let mut inputs = vec![("query", Value::Text(query))];
    if let Some(scope) = scope {
        inputs.extend(scope.from.iter().map(|path| ("from", Value::Text(path))));
        inputs.extend(scope.to.iter().map(|path| ("to", Value::Text(path))));
    }
    inputs.push(("limit", Value::Text(&limit)));
    format!("`{}` lists all matching names.", typed(CLI, "search", &inputs))
}

fn compact(answer: &mut Vec<String>, heading: String, total: usize, limit: Option<usize>, rows: impl Iterator<Item = String>, again: impl Fn(usize) -> String) {
    let names: Vec<_> = rows.take(limit.unwrap_or(5)).collect();
    let rest = total.saturating_sub(names.len());
    let tail = if rest > 0 { format!(" and {rest} more. {}", again(total)) } else { ".".into() };
    answer.extend([String::new(), format!("{heading}: {}{tail}", names.join(", "))]);
}

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
