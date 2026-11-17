//! Join source facts held by a Help reading with the manifests that name its doors.

// compass: variance-authority.report.agent-surface

use std::collections::HashMap;
use napi_derive::napi;

use crate::help_names::PublishedName;
use crate::help_store::{StoreEntry, StoreOpening, StorePackage, StoreUse};
use crate::help_usage::{IndexedUsage, NameUse};

#[path = "help_mentions.rs"]
mod mentions;

/// Package metadata from manifests; every source-derived field stays native.
#[napi(object)]
pub struct HelpPackage {
    pub name: String,
    pub entry: bool,
    pub openings: Vec<HelpOpening>,
}

#[napi(object)]
pub struct HelpOpening {
    pub subpath: String,
    pub source: String,
}

pub(crate) fn assemble(root: &str, packages: Vec<HelpPackage>, names: Vec<Vec<PublishedName>>, usage: &IndexedUsage) -> Result<Vec<StorePackage>, String> {
    let mut names = names.into_iter();
    let mut docs = mentions::Readmes::new(root);
    let mut grouped: HashMap<(&str, &str), Vec<&NameUse>> = HashMap::new();
    for used in &usage.names { grouped.entry((&used.key, &used.name)).or_default().push(used); }
    packages.into_iter().map(|package| {
        let openings = package.openings.into_iter().map(|opening| {
            let key = format!("{} {}", package.name, opening.subpath);
            let mut entries = Vec::new();
            for name in names.next().ok_or("the reading holds fewer openings than the manifests")? {
                let first = name.kinds.first().ok_or_else(|| format!("`{}` was reached with no declaration behind it", name.name))?;
                let held = grouped.get(&(key.as_str(), name.name.as_str())).map(Vec::as_slice).unwrap_or(&[]);
                let mut used_by = Vec::new();
                let mut sites = Vec::new();
                let mut through_default = Vec::new();
                for used in held {
                    if used.through_default { through_default.push(store_use(used)); }
                    else {
                        if used.by != package.name && !used_by.contains(&used.by) { used_by.push(used.by.clone()); }
                        sites.push(store_use(used));
                    }
                }
                let mut kinds: Vec<&str> = name.kinds.iter().map(|kind| kind.kind.as_str()).collect();
                kinds.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
                let mention = if first.doc.is_none() { docs.mention(&first.at, &name.name)? } else { None };
                entries.push(StoreEntry {
                    name: name.name, kind: kinds.join("+"), at: first.at.clone(), declared: first.declared.clone(), line: first.line,
                    signature: first.signature.clone(), doc: first.doc.clone(), used_by, uses: sites.len() as u32,
                    sites, through_default, mention,
                });
            }
            entries.sort_by(|a, b| b.used_by.len().cmp(&a.used_by.len()).then_with(|| b.uses.cmp(&a.uses)).then_with(|| crate::order::code_unit(&a.name, &b.name)));
            let whole = grouped.get(&(key.as_str(), "*")).into_iter().flatten().map(|used| store_use(used)).collect();
            let spec = format!("{}{}", package.name, if opening.subpath == "." { "" } else { &opening.subpath[1..] });
            Ok(StoreOpening { subpath: opening.subpath, source: opening.source, spec, entries, whole })
        }).collect::<Result<Vec<_>, String>>()?;
        Ok(StorePackage { name: package.name, entry: package.entry, openings })
    }).collect()
}

fn store_use(used: &NameUse) -> StoreUse {
    StoreUse {
        by: used.by.clone(), at: used.at.clone(), line: used.line, r#type: used.r#type, kind: used.kind.clone(), local: used.local.clone(),
        through: used.through.clone(), through_line: used.through_line, through_default: used.through_default, whole: used.whole, name: None,
    }
}
