//! Names a file exports and no entry publishes: every export of ordinary source
//! that answers to the name, and the file that declares what each exports.

// compass: variance-authority.report.agent-surface

use crate::help_key::{says, Key, Keys};
use crate::help_name_scope::PackageScope;
use crate::help_symbol_rows::Export;

/// What an import count leaves out: a use that names the export without importing it.
pub(crate) const UNCOUNTED: &str = "a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted";

/// One export of the name asked, with what its row records beside the name.
pub(crate) struct Unpublished<'a> {
    pub export: Export<'a>,
    pub line: u32,
    pub type_only: bool,
    /// The kind of the declaration it binds in its own file; `None` for `export … from`.
    pub declaration: Option<&'a str>,
    /// The file declaring what it exports: its own, or the one it passes on.
    pub declared_at: String,
    /// The declaration it exports, as `Keys` keys it.
    pub key: Key,
}

impl Unpublished<'_> {
    /// Whether the export is written under `name` and keys a declaration of that name exported under it alone: the one shape `uses` carries.
    pub(crate) fn plain(&self, name: &str) -> bool {
        says(self.export.name, name) && self.key.named == name && self.key.spellings.iter().all(|one| one == name)
    }
}

/// Every export from ordinary source that answers to `name` and `package`
/// keeps: those written under it first, then, of the files that write none,
/// the exports keyed by it, each in export-list order.
pub(crate) fn exports_named<'a>(keys: &Keys<'a>, name: &str, package: &PackageScope<'_>) -> Option<Vec<Unpublished<'a>>> {
    let rows = keys.rows();
    let mut answering = Vec::new();
    for held in keys.answering(name)? {
        if rows.export_kind(&held)? == "source" { answering.push(held) }
    }
    // A file that exports the binding by the name is answered by that export, not by its other names.
    let (spelled, keyed): (Vec<_>, Vec<_>) = answering.into_iter().partition(|held| says(held.name, name));
    let keyed: Vec<_> = keyed.into_iter().filter(|held| !spelled.iter().any(|other| other.at == held.at)).collect();
    spelled.into_iter().chain(keyed).filter(|held| package.export(held)).map(|export| {
        let key = keys.key_of(export.at, export.name)?;
        Some(Unpublished {
            line: rows.export_line(&export)?,
            type_only: rows.export_type(&export)?,
            declaration: rows.export_declaration(&export)?,
            declared_at: key.at.clone(),
            key,
            export,
        })
    }).collect()
}

/// `at:line` of the first export, and how many more there are past it.
pub(crate) fn exported_at(exported: &[&Unpublished<'_>]) -> String {
    let Some(first) = exported.first() else { return String::new() };
    let more = if exported.len() > 1 { format!(" and {} more", exported.len() - 1) } else { String::new() };
    format!("{}:{}{more}", first.export.at, first.line)
}
