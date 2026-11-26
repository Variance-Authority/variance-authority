//! Which export of a name an import by path reaches: one rule, read by
//! `symbol` and by `uses` alike.

// compass: variance-authority.report.agent-surface

use crate::compact::Layer;
use crate::help_origin::declaration_exported;
use crate::help_symbol_rows::{Export, PathSite};
use crate::help_usage::requested;

/// The export of `name`, among `exports`, that `site` imports.
///
/// A path the index resolved lands on the export in the file it names, or on
/// the one whose declaration that file passes on, as a barrel's `export *`
/// does. A path the index did not resolve is not known to lead nowhere: it
/// lands on the export the package its specifier names owns, when every export
/// that package owns binds one declaration. `None` where it reaches no export,
/// or several declarations.
pub(crate) fn landing<'e, 'a>(layers: &[Layer], name: &str, site: &PathSite<'_>, exports: &[&'e Export<'a>]) -> Option<&'e Export<'a>> {
    let declared = |export: &Export<'_>| declaration_exported(layers, export.at, export.name).map(|one| (one.at, one.line));
    let Some(to) = site.to else {
        let (owner, _) = requested(site.specifier);
        let mut owned = exports.iter().copied().filter(|export| export.by == owner);
        let first = owned.next()?;
        let one = declared(first);
        return owned.all(|other| other.at == first.at || (one.is_some() && declared(other) == one)).then_some(first);
    };
    if let Some(export) = exports.iter().copied().find(|export| export.at == to) { return Some(export) }
    let reached = declaration_exported(layers, to, name)?;
    exports.iter().copied().find(|export| declared(export).is_some_and(|(at, line)| at == reached.at && line == reached.line))
}
