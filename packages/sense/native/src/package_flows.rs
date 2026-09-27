//! One side of an asked package's traffic, as shares.
//!
//! The package graph (`package_graph.rs`) counts units — one importing file
//! taking one name from one other package — and this turns one package's
//! counts into the rows an answer prints: the other packages in the order they
//! matter, each with the names that carry it.
//!
//! A package's share is over the side's total, so the rows of one side add up
//! to the whole of it. A name's share is over every unit the package exporting
//! it gets from outside, because a name's weight is what part of that package's
//! use it is: `Button` at forty percent of a design system says what the design
//! system is for, and forty percent of one importer's intake says only what the
//! importer happened to need. On the side that uses the asked package the
//! exporter is the asked package, and the two totals are one. What falls past a
//! limit is counted and given its share rather than dropped, so the rows shown
//! are never mistaken for the whole.

// compass: variance-authority.reach.relations

use std::cmp::Reverse;
use std::collections::HashMap;

use napi_derive::napi;

use crate::order::code_unit;
use crate::package_owners::Package;

/// Per other package, how many units take each name.
pub(crate) type Uses<'a> = HashMap<u32, HashMap<&'a str, u32>>;

#[napi(object)]
pub struct OrientShare {
    pub name: String,
    /// This row's units of the name over every unit the package exporting it
    /// gets from outside.
    pub share: f64,
}

#[napi(object)]
pub struct OrientFlow {
    /// The other package, `undefined` for files no named manifest sits above.
    pub package: Option<String>,
    pub directory: Option<String>,
    /// This package's units over the side's total.
    pub share: f64,
    pub names: Vec<OrientShare>,
    /// Names past the limit.
    pub more_names: u32,
}

#[napi(object)]
pub struct OrientFlows {
    pub rows: Vec<OrientFlow>,
    /// Packages past the limit, and their share together.
    pub more: u32,
    pub more_share: f64,
    /// The side's total units.
    pub units: u32,
    /// Importing files on this side whose names were not read, because their
    /// parse could not be joined to them. Their uses are in no total.
    pub unread: u32,
}

/// The rows for one side, largest share first, ties in code-unit order of the
/// other package's directory. `outside` is, per other package, the total its
/// names are over: everything the package exporting them gets from outside.
pub(crate) fn flows<'p>(
    uses: &Uses,
    named: &impl Fn(u32) -> Option<&'p Package>,
    limits: crate::package_graph::Limits,
    unread: u32,
    outside: &dyn Fn(u32) -> u32,
) -> OrientFlows {
    let total: u32 = uses.values().flat_map(HashMap::values).sum();
    let over = |units: u32, total: u32| if total == 0 { 0.0 } else { f64::from(units) / f64::from(total) };
    let share = |units: u32| over(units, total);
    let mut others: Vec<(u32, u32)> = uses.iter().map(|(&other, names)| (other, names.values().sum())).collect();
    let directory = |other: u32| named(other).map(|package| package.directory.as_str());
    others.sort_unstable_by(|left, right| {
        Reverse(left.1).cmp(&Reverse(right.1)).then_with(|| match (directory(left.0), directory(right.0)) {
            (Some(left), Some(right)) => code_unit(left, right),
            (left, right) => left.is_none().cmp(&right.is_none()),
        })
    });
    let shown = others.len().min(limits.rows);
    let rows = others[..shown]
        .iter()
        .map(|&(other, units)| {
            let mut names: Vec<(&str, u32)> = uses[&other].iter().map(|(&name, &count)| (name, count)).collect();
            names.sort_unstable_by(|left, right| Reverse(left.1).cmp(&Reverse(right.1)).then_with(|| code_unit(left.0, right.0)));
            let kept = names.len().min(limits.names);
            let exported = outside(other);
            OrientFlow {
                package: named(other).map(|package| package.name.clone()),
                directory: named(other).map(|package| package.directory.clone()),
                share: share(units),
                names: names[..kept].iter().map(|&(name, count)| OrientShare { name: name.to_owned(), share: over(count, exported) }).collect(),
                more_names: (names.len() - kept) as u32,
            }
        })
        .collect();
    let rest: u32 = others[shown..].iter().map(|&(_, units)| units).sum();
    OrientFlows { rows, more: (others.len() - shown) as u32, more_share: share(rest), units: total, unread }
}
