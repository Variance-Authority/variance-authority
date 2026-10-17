//! Which declaration a module's export of a name resolves to: ECMAScript's
//! export resolution, walked over whichever reading of the modules a caller
//! holds.
//!
//! A file's own export list decides first: a top-level declaration it binds the
//! name to, or an import it exports again, which the walk follows. Then a named
//! `export … from` of the name decides, whatever it reaches. Only then are the
//! file's stars read: no star passes `default`, a star that does not export the
//! name is passed over, and two stars that reach different declarations leave
//! the name ambiguous, which resolves to nothing. What the reading cannot say —
//! a request to no file of the checkout, a file it holds no export list of, a
//! namespace — leaves the name undecided rather than letting another star
//! answer for it.
//!
//! The source index's parses answer where a passed-on name is declared
//! (`help_origin.rs`), and the journeys' parses answer which function a call
//! through a barrel lands in (`journeys_graph.rs`); each implements
//! [`Modules`] over its own reading.

// compass: variance-authority.reach.relations

use std::collections::HashSet;
use std::hash::Hash;

/// A reading of the checkout's modules the walk runs over.
pub(crate) trait Modules {
    /// How the reading names a file.
    type File: Clone + Eq + Hash;
    /// What the reading says a declaration is.
    type Declaration: PartialEq;

    /// What `file` exports under `name`, as [`Exports`] says.
    fn exports(&self, file: &Self::File, name: &str) -> Exports<Self::File, Self::Declaration>;
}

/// What one file exports under one name.
pub(crate) enum Exports<F, D> {
    /// Its own export list binds the name.
    Own(Bound<F, D>),
    /// Its own export list does not hold the name; what it passes it on from.
    Passes(Passes<F>),
    /// The reading holds no export list of the file.
    Unread,
}

/// How a file's own export list binds a name.
pub(crate) enum Bound<F, D> {
    /// A declaration of the file.
    Declared(D),
    /// An import the file exports again: the file its request resolved to,
    /// `None` for no file of the checkout, and the name it has there.
    Imported(Option<F>, String),
    /// A namespace import, or a binding the reading holds neither a
    /// declaration nor an import of.
    Unbound,
}

/// What one file passes a name on from.
pub(crate) struct Passes<F> {
    /// Its named `export … from` of the name: the file the request resolved to
    /// and the name it has there, or `None` when that is nothing the walk can
    /// follow, a namespace (`export * as`) or a request to no file of the checkout.
    pub named: Option<Option<(F, String)>>,
    /// The file each `export *` resolved to, `None` for one that resolved to
    /// no file of the checkout.
    pub stars: Vec<Option<F>>,
}

/// Where a walk ends. Undecided is kept apart from nothing because it carries
/// upward: a star that cannot say what it exports under the name makes the
/// file passing it on undecided too, where a star that does not export the
/// name is passed over.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Reached<D> {
    Declaration(D),
    /// Two stars reach different declarations, or the walk reaches what the
    /// reading cannot say or a binding that is no declaration.
    Undecided,
    /// The file does not export the name, or the walk already passed through it.
    Nothing,
}

impl<D> Reached<D> {
    pub(crate) fn declaration(self) -> Option<D> {
        match self {
            Reached::Declaration(found) => Some(found),
            Reached::Undecided | Reached::Nothing => None,
        }
    }
}

/// The declaration the export `name` of `file` resolves to.
pub(crate) fn resolve_export<M: Modules>(modules: &M, file: &M::File, name: &str) -> Reached<M::Declaration> {
    step(modules, file.clone(), name.to_owned(), &mut HashSet::new())
}

/// Where an import a file exports again leads: undecided when its request
/// resolved to no file of the checkout.
fn follow<M: Modules>(modules: &M, to: Option<M::File>, name: String, passed: &mut HashSet<(M::File, String)>) -> Reached<M::Declaration> {
    match to {
        Some(to) => step(modules, to, name, passed),
        None => Reached::Undecided,
    }
}

/// What `file` exports under `name`; nothing when the walk already passed
/// through `file` under that name.
fn step<M: Modules>(modules: &M, file: M::File, name: String, passed: &mut HashSet<(M::File, String)>) -> Reached<M::Declaration> {
    if !passed.insert((file.clone(), name.clone())) {
        return Reached::Nothing;
    }
    match modules.exports(&file, &name) {
        Exports::Own(Bound::Declared(found)) => Reached::Declaration(found),
        Exports::Own(Bound::Imported(to, imported)) => follow(modules, to, imported, passed),
        Exports::Own(Bound::Unbound) | Exports::Unread => Reached::Undecided,
        Exports::Passes(passes) => walk(modules, passes, &name, passed),
    }
}

/// What a file passes `name` on from: its named `export … from` of the name
/// decides whatever it reaches, and its stars are read only when there is none.
fn walk<M: Modules>(modules: &M, passes: Passes<M::File>, name: &str, passed: &mut HashSet<(M::File, String)>) -> Reached<M::Declaration> {
    if let Some(hop) = passes.named {
        return match hop {
            Some((to, imported)) => step(modules, to, imported, passed),
            None => Reached::Undecided,
        };
    }
    if name == "default" {
        return Reached::Nothing;
    }
    let mut reached: Option<M::Declaration> = None;
    for star in passes.stars {
        let Some(to) = star else { return Reached::Undecided };
        match step(modules, to, name.to_owned(), passed) {
            Reached::Nothing => {}
            Reached::Undecided => return Reached::Undecided,
            Reached::Declaration(found) => {
                if reached.as_ref().is_some_and(|first| *first != found) {
                    return Reached::Undecided;
                }
                reached = Some(found);
            }
        }
    }
    reached.map_or(Reached::Nothing, Reached::Declaration)
}
