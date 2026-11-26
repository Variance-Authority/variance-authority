//! A name an import binds with `as`, as `symbol` answers it.
//!
//! `import { stringReader as openStrings } from './strings.js'` binds
//! `openStrings` in its file to the export `stringReader` of the file the
//! request resolves to. The binding the parse recorded is the one fact that
//! ties the two names, so `symbol` asked for `openStrings` reads the binding
//! and answers the export it names. Nothing is related by how a name is spelled.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;
use std::path::Path;

use crate::compact::Layer;
use crate::help_aliases::Alias;
use crate::help_key::{Keys, SLOT};
use crate::help_name_scope::PackageScope;
use crate::help_symbol_answer::dependencies::imported_from;
use crate::help_symbol_exported::{exported_rows, Opening};
use crate::help_symbol_published::{door_lines, member_rows};
use crate::help_symbol_rows::Entry;
use crate::help_uses_answer::Counts;

/// How many places one line names.
const CAP: usize = 12;

/// One local name's answer: `text` in full, and `brief` when its original is
/// an export of the checkout, which says the declaration by its line instead
/// of showing it again, with that declaration's key, `at\0named`.
pub(crate) struct LocalName {
    pub text: String,
    pub brief: Option<(String, String)>,
    /// Each import that binds the local name, and the declaration it names, as `file`, `line` and the name written there.
    pub files: Vec<(String, u32, String)>,
}

/// What `symbol` says about `local` as the name the imports `aliases` bind:
/// for each export they name, the imports that rename it and the export itself.
/// `package` keeps the exports of the package asked.
pub(crate) fn local_names(keys: &Keys<'_>, layers: &[Layer], lexicon: &Path, local: &str, aliases: Vec<Alias>, package: &PackageScope<'_>) -> Option<Vec<LocalName>> {
    let rows = keys.rows();
    // The imports that name one export: the same imported name out of the same resolved file, or the same specifier when none resolved.
    let mut groups: Vec<((String, Option<String>, String), Vec<Alias>)> = Vec::new();
    for alias in aliases {
        let key = (alias.imported.clone(), alias.to.clone(), if alias.to.is_none() { alias.specifier.clone() } else { String::new() });
        match groups.iter_mut().find(|(held, _)| *held == key) {
            Some((_, group)) => group.push(alias),
            None => groups.push((key, vec![alias])),
        }
    }
    if groups.is_empty() { return Some(Vec::new()) }
    let unfollowed = rows.unfollowed()?;
    let mut blocks = Vec::new();
    for (_, group) in groups {
        let first = &group[0];
        let held = match &first.to {
            Some(to) => rows.exports_in(to)?.into_iter().find(|one| one.name == first.imported),
            None => None,
        };
        let declared = match &held {
            Some(held) => Some(keys.key_of(held.at, held.name)?.named),
            None => None,
        };
        // `import greet from` a file exporting `greet` as `default` too binds the declaration by its own name: no local name.
        if declared.as_deref() == Some(local) { continue }
        // The slot `default` is said by the name its declaration is keyed by.
        let named = if first.imported == SLOT { declared.as_deref().unwrap_or(&first.imported) } else { &first.imported };
        let Some(original) = original_of(keys, layers, lexicon, &unfollowed, first, package, named)? else { continue };
        let its = if *named == first.imported { String::new() } else { format!(" (its `{}`)", first.imported) };
        let typed = if first.r#type { " (type only)" } else { "" };
        let mut lead = vec![format!("`{local}` is a local name: {}:{} imports `{named}`{its} as `{local}` from '{}'{typed}.", first.at, first.line, first.specifier)];
        if group.len() > 1 {
            let also = &group[1..];
            let at = also.iter().take(CAP).map(|alias| format!("{}:{}", alias.at, alias.line)).collect::<Vec<_>>().join(", ");
            let more = if also.len() > CAP { format!(", and {} more", also.len() - CAP) } else { String::new() };
            lead.push(format!("Also imported as `{local}` at {at}{more}."));
        }
        lead.push(String::new());
        let brief = original.brief.map(|(rows, declares, key)| {
            let mut lines = lead.clone();
            lines.extend(rows);
            lines.push(format!("Its declaration, at {declares}, is answered above."));
            (lines.join("\n"), key)
        });
        lead.push(original.text);
        let mut files: Vec<_> = group.iter().map(|alias| (alias.at.clone(), alias.line, local.to_owned())).collect();
        files.extend(original.at);
        blocks.push(LocalName { text: lead.join("\n"), brief, files });
    }
    Some(blocks)
}

/// The export one import names, and, when it is the checkout's, the rows that name it without its declaration, where that declaration is, and its key.
struct Original {
    text: String,
    brief: Option<(Vec<String>, String, String)>,
    /// The export and the declaration it reaches, as `file`, `line` and name; none when it is no file of the checkout.
    at: Vec<(String, u32, String)>,
}

/// The published entry the import's specifier opens or whose file it resolved
/// to, else the export of that file, followed to the declaration it passes on,
/// else the installed declaration the specifier names; said as unknown when
/// none answers. `None` inside when `package` asks for another package.
fn original_of(keys: &Keys<'_>, layers: &[Layer], lexicon: &Path, unfollowed: &HashSet<&str>, alias: &Alias, package: &PackageScope<'_>, said: &str) -> Option<Option<Original>> {
    let rows = keys.rows();
    let name = alias.imported.as_str();
    let wanted = package.wanted();
    if let Some(entry) = entry_named(keys, name, &alias.specifier, alias.to.as_deref())? {
        if wanted.is_some() && !package.entry(&entry) { return Some(None) }
        // The original's own sites are not read here, so the entry's are what may read it.
        let may: Vec<_> = entry.sites.iter().copied().filter(|site| (site.off || site.whole) && site.by != entry.package).collect();
        let import = (entry.name != SLOT).then(|| format!("import {{ {} }} from '{}';", entry.name, entry.specifier));
        let mut lines = door_lines(&entry, entry.name, import, &Counts::of(&may, entry.package));
        lines.extend(member_rows(layers, entry.at, entry.name, entry.line));
        return Some(Some(Original { text: lines.join("\n"), brief: None, at: vec![(entry.at.to_owned(), entry.line, entry.name.to_owned())] }));
    }
    if let Some(to) = &alias.to {
        if let Some(held) = rows.exports_in(to)?.into_iter().find(|one| one.name == name) {
            if wanted.is_some_and(|wanted| held.by != wanted) { return Some(None) }
            let Opening { at, on, line, passes, mut lines } = exported_rows(keys, layers, unfollowed, said, &held, rows.export_line(&held)?, rows.export_type(&held)?)?;
            let brief = lines[..lines.len().min(if passes { 3 } else { 2 })].to_vec();
            let key = keys.key_of(held.at, held.name)?;
            lines.extend(member_rows(layers, &at, &on, line));
            let mut files = vec![(held.at.to_owned(), rows.export_line(&held)?, held.name.to_owned())];
            if passes { files.push((at.clone(), line, on.clone())) }
            return Some(Some(Original { text: lines.join("\n"), brief: Some((brief, format!("{at}:{line}"), format!("{}\0{}", key.at, key.named))), at: files }));
        }
    }
    if let Some(text) = imported_from(lexicon, name, &alias.at, &alias.specifier, wanted)? {
        return Some(Some(Original { text, brief: None, at: Vec::new() }));
    }
    if wanted.is_some() { return Some(None) }
    let text = match &alias.to {
        None => format!("Where `{name}` is declared is not known: the source index did not resolve '{}' to a file.", alias.specifier),
        Some(to) => format!("Where `{name}` is declared is not known: {to} exports no `{name}` this reading holds."),
    };
    Some(Some(Original { text, brief: None, at: Vec::new() }))
}

/// The entry published under `name` that `specifier` opens, else one declared in `at`.
fn entry_named<'r>(keys: &Keys<'r>, name: &str, specifier: &str, at: Option<&str>) -> Option<Option<Entry<'r>>> {
    let rows = keys.rows();
    let mut named = Vec::new();
    for row in rows.published_spelled(name)? { named.push(rows.entry(row)?) }
    let at_door = named.iter().position(|entry| entry.specifier == specifier);
    let at_file = || at.and_then(|at| named.iter().position(|entry| entry.at == at));
    Some(at_door.or_else(at_file).map(|found| named.swap_remove(found)))
}
