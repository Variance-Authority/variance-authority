//! Names a file exports and no entry publishes: every export of ordinary source
//! that answers to the name, and the file that declares what each exports.

// compass: variance-authority.report.agent-surface

use crate::compact::Layer;
use crate::help_origin::declaration_exported;
use crate::help_symbol_rows::{Export, Rows};

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
}

/// Every export of `name` among `candidates` from ordinary source, in row
/// order, each keyed by the file declaring it; `all` is every export row the
/// name or its binding names. `None` where an export answers to `name` by a
/// key this reading does not follow: a default the name binds, a binding its
/// file exports under another name too, or one passed on under another name.
pub(crate) fn exports_named<'a>(rows: &'a Rows, layers: &[Layer], name: &str, all: &[Export<'a>], candidates: &[Export<'a>]) -> Option<Vec<Unpublished<'a>>> {
    if name == "default" { return None }
    let mut source = Vec::new();
    for export in candidates {
        if rows.export_kind(export)? == "source" { source.push(export) }
    }
    let spelled: Vec<_> = source.iter().copied().filter(|export| export.name == name).collect();
    // A file exporting the binding only as `default` answers to it by the binding's name.
    for keyed in source.iter().filter(|export| export.name != name && export.bound == Some(name) && !spelled.iter().any(|held| held.at == export.at)) {
        if spellings(all, keyed.at, name).all(|spelled| spelled == "default") { return None }
    }
    spelled.into_iter().map(|export| {
        let declared_at = match export.bound {
            Some(bound) => {
                let others = if bound == name { all.to_vec() } else { rows.exports(bound)? };
                if spellings(&others, export.at, bound).any(|spelled| spelled != name) { return None }
                export.at.to_owned()
            }
            None => match declaration_exported(layers, export.at, name) {
                Some(origin) if origin.at != export.at => {
                    if origin.name != name || spellings(all, &origin.at, name).any(|spelled| spelled != name) { return None }
                    origin.at
                }
                _ => export.at.to_owned(),
            },
        };
        Some(Unpublished {
            export: export.clone(),
            line: rows.export_line(export)?,
            type_only: rows.export_type(export)?,
            declaration: rows.export_declaration(export)?,
            declared_at,
        })
    }).collect()
}

/// The names `at` exports the binding `bound` under.
fn spellings<'e>(exports: &'e [Export<'_>], at: &'e str, bound: &'e str) -> impl Iterator<Item = &'e str> + 'e {
    exports.iter().filter(move |export| export.at == at && export.bound == Some(bound)).map(|export| export.name)
}

/// `at:line` of the first export, and how many more there are past it.
pub(crate) fn exported_at(exported: &[&Unpublished<'_>]) -> String {
    let Some(first) = exported.first() else { return String::new() };
    let more = if exported.len() > 1 { format!(" and {} more", exported.len() - 1) } else { String::new() };
    format!("{}:{}{more}", first.export.at, first.line)
}
