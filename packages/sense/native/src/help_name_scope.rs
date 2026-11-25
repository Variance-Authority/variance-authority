//! Match a package, or the exact specifier the question names.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeSet;

use crate::help_symbol_rows::{Entry, Export, Rows};
use crate::help_usage::kind_of;
pub(crate) use crate::help_usage::package_name as owner_of;

pub(crate) struct PackageScope<'a> {
    wanted: Option<&'a str>,
    owner: Option<&'a str>,
    resolved: BTreeSet<&'a str>,
}

impl<'a> PackageScope<'a> {
    pub(crate) fn read(rows: &'a Rows, wanted: Option<&'a str>) -> Option<Self> {
        let owner = wanted.map(owner_of);
        let resolved = match wanted {
            Some(spec) if Some(spec) != owner => rows.paths_written(spec)?,
            _ => BTreeSet::new(),
        };
        Some(Self { wanted, owner, resolved })
    }

    pub(crate) fn wanted(&self) -> Option<&str> {
        self.wanted
    }

    pub(crate) fn entry(&self, entry: &Entry<'_>) -> bool {
        self.wanted.is_none_or(|wanted| entry.package == wanted || entry.specifier == wanted)
    }

    pub(crate) fn export(&self, export: &Export<'_>) -> bool {
        self.wanted.is_none_or(|wanted| {
            kind_of(export.at) == "source"
                && (export.by == wanted || (Some(export.by) == self.owner && self.resolved.contains(export.at)))
        })
    }

    pub(crate) fn path(&self, specifier: &str) -> bool {
        self.wanted.is_none_or(|wanted| specifier == wanted || owner_of(specifier) == wanted)
    }

    pub(crate) fn declared(&self, package: &str) -> bool {
        self.wanted.is_none_or(|wanted| wanted == package)
    }

    pub(crate) fn member(&self, package: &str) -> bool {
        self.owner.is_none_or(|owner| owner == package)
    }

    /// Imports through a different opening of the asked package belong to that opening.
    pub(crate) fn through(&self, specifier: &str) -> bool {
        self.wanted == self.owner
            || specifier.starts_with('.')
            || self.owner != Some(owner_of(specifier))
            || self.wanted == Some(specifier)
    }

    /// An exact export elsewhere can explain a package-scoped miss.
    pub(crate) fn export_hint(&self, rows: &Rows, name: &str, exports: &[Export<'_>]) -> Option<Option<String>> {
        let Some(wanted) = self.wanted else { return Some(None) };
        let mut found = exports.iter().filter(|held| held.name == name && kind_of(held.at) == "source");
        let Some(first) = found.next() else { return Some(None) };
        let mut unknown = self.owner != self.wanted && self.resolved.is_empty() && self.owner == Some(first.by);
        let mut rest = 0;
        for export in found {
            rest += 1;
            unknown |= self.owner != self.wanted && self.resolved.is_empty() && self.owner == Some(export.by);
        }
        let more = if rest == 0 { String::new() } else { format!(" and {rest} more") };
        let why = if unknown {
            format!("; no import of `{wanted}` in this workspace resolved to a file, so the file it names is not known")
        } else {
            String::new()
        };
        Some(Some(format!(
            "it is exported, without being published, at {}:{}{more}{why}.",
            first.at,
            rows.export_line(first)?
        )))
    }
}
