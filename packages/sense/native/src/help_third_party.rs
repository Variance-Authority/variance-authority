//! Who imports a name out of a package the workspace installs rather than writes.
//!
//! The declaration is not in the checkout, but every import of it is. Which
//! requests are for such a package is `external_requests`'s to say, the rule
//! the external-dependency orientation and the dependency lexicon read too, so
//! the three never disagree; this reads each of those requests per binding, so
//! a site has its own line and the name it binds. A file whose imports that
//! rule cannot read is named rather than passed over, since it may import the
//! name.
//!
//! The rule's two halves run apart here: which requests went unresolved reads
//! the index alone, and which of their packages are the workspace's own reads
//! its manifests. Most names asked of are the workspace's, bound by no
//! unresolved request, so the manifests are read only when a binding of the
//! name, or a record that does not line up with its parse, waits on them.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::external_dependencies::unresolved_requests;
use crate::help_usage::{kind_of, taken, NameUse};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};

/// One import of a name out of an installed package.
#[napi(object)]
pub struct OutsideUse {
    /// The package the specifier names.
    pub package: String,
    /// The request is an `export … from`, which passes the name on.
    pub passes_on: bool,
    pub site: NameUse,
}

/// Every import of a name out of the packages the workspace installs, and the
/// files whose imports were not read.
#[napi(object)]
pub struct OutsideImports {
    pub uses: Vec<OutsideUse>,
    /// Files the index holds whose imports do not read, in code-unit order.
    pub unread: Vec<String>,
}

/// Every import of `name` out of a package no manifest of the workspace
/// declares, by any file on the chain: each binding, including one an
/// `export … from` passes on, and each member read off a module held whole.
/// An `export *` names no name, so it is no import of this one. A use's `key`
/// is the specifier as written. Ordered by the importing file in code units,
/// then by line, then by specifier.
pub(crate) fn third_party_importers(root: &str, layers: &[Layer], name: &str) -> OutsideImports {
    let folded = fold(layers);
    // A record that names a package, or that did not read, is the rule's to answer.
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &(layer, row))| {
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            records.unknown_of(stored, row).is_some() || records.packages_of(stored, row).next().is_some()
        })
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let read: Vec<Read> = crossings.par_iter().map(|crossing| read_crossing(layers, crossing, name)).collect();
    let waits = read.iter().any(|one| match one {
        Read::Found(found) => !found.is_empty(),
        Read::Unknown(_) => false,
        Read::Unaligned(..) => true,
    });
    if !waits {
        let unread = read.into_iter().filter_map(|one| if let Read::Unknown(file) = one { Some(file.to_owned()) } else { None }).collect();
        return OutsideImports { uses: Vec::new(), unread };
    }
    let paths = beside(root, folded.keys().copied());
    let owners = owners(root, &paths);
    let internal: HashSet<&str> = owners.packages.iter().map(|package| package.name.as_str()).collect();
    let mut uses = Vec::new();
    let mut unread = Vec::new();
    for one in read {
        match one {
            Read::Found(found) => uses.extend(found.into_iter().filter(|one| !internal.contains(one.package.as_str())).map(|mut one| {
                one.site.by = owners.package_of(&one.site.at).to_owned();
                one
            })),
            Read::Unknown(file) => unread.push(file.to_owned()),
            // A record that names only the workspace's own packages imports nothing from outside it.
            Read::Unaligned(file, (layer, row)) => {
                let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                if records.packages_of(stored, row).any(|package| !internal.contains(package)) { unread.push(file.to_owned()); }
            }
        }
    }
    uses.sort_by(|a, b| {
        let (a, b) = (&a.site, &b.site);
        crate::order::code_unit(&a.at, &b.at)
            .then(a.line.cmp(&b.line))
            .then_with(|| crate::order::code_unit(&a.key, &b.key))
            .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
    });
    OutsideImports { uses, unread }
}

/// What one crossing answers before the workspace's own packages are known.
enum Read<'l> {
    /// Every binding of the name off a request the scan did not resolve, the importing package not yet filled in.
    Found(Vec<OutsideUse>),
    /// A record that did not read: unread whatever the manifests say.
    Unknown(&'l str),
    /// A record that names packages and that its parse does not line up with: unread when one of them is outside.
    Unaligned(&'l str, At),
}

fn read_crossing<'l>(layers: &[Layer], crossing: &Crossing<'l>, name: &str) -> Read<'l> {
    let Ok(requests) = unresolved_requests(layers, crossing) else {
        let (layer, row) = crossing.at;
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if records.unknown_of(stored, row).is_some() { return Read::Unknown(crossing.file); }
        return Read::Unaligned(crossing.file, crossing.at);
    };
    let Some((layer, row)) = crossing.parse else { return Read::Found(Vec::new()) };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let kind = kind_of(crossing.file);
    let mut found = Vec::new();
    for (request, package) in requests {
        let written = text.text(parses.request_value.at(request));
        let passes_on = parses.request_republishes[request] == 1;
        for (site, _) in taken(&layers[layer], row, request, written, "", crossing.file, kind) {
            if site.name == name { found.push(OutsideUse { package: package.to_owned(), passes_on, site }); }
        }
    }
    Read::Found(found)
}

#[cfg(test)]
#[path = "help_third_party_tests.rs"]
mod tests;
