//! Which export of a name an import by path reaches: one rule, read by
//! `symbol` and by `uses` alike.

// compass: variance-authority.report.agent-surface

use crate::compact::Layer;
use crate::help_origin::declaration_exported;
use crate::help_symbol_rows::{Export, PathSite};

/// The export of `name`, among `exports`, that `site` imports.
///
/// A path the index resolved lands on the export in the file it names, or on
/// the one whose declaration that file passes on, as a barrel's `export *`
/// does. A path the index resolved to no file lands on none: its specifier
/// names a package, not the file the import reaches. `None` where it reaches
/// no export.
pub(crate) fn landing<'e, 'a>(layers: &[Layer], name: &str, site: &PathSite<'_>, exports: &[&'e Export<'a>]) -> Option<&'e Export<'a>> {
    let declared = |export: &Export<'_>| declaration_exported(layers, export.at, export.name).map(|one| (one.at, one.line));
    let to = site.to?;
    if let Some(export) = exports.iter().copied().find(|export| export.at == to) { return Some(export) }
    let reached = declaration_exported(layers, to, name)?;
    exports.iter().copied().find(|export| declared(export).is_some_and(|(at, line)| at == reached.at && line == reached.line))
}
