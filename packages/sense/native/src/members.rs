//! The names a module reads off another module it holds as an object.
//!
//! A namespace import, TypeScript's `import m = require('m')`, an `import()` and
//! a `require` hold the module whole, and the names the file uses are member
//! reads further down — `ns.x`, `(await import('m')).x`, `m.x` after
//! `const m = await import('m')` or `import m = require('m')`,
//! `const { x } = await import('m')`, the element of
//! `const [{ x }] = await Promise.all([import('m')])` in the same position, and
//! the callback of `import('m').then(…)`. What a `require` returns is the
//! module, read as an awaited `import()` is. A cast changes no value, and a rest
//! holds the module too; a read off the promise `import()` returns is the
//! promise's, not the module's. Each of those is recorded against the
//! request it reads through, by that request's index in the parse. An
//! `import m = require()` holds from where it is written on, as the `const`
//! TypeScript compiles it to does. A default import holds the module's
//! `default`, which under interop is a CommonJS module's `module.exports`. A
//! type-only import of any of these holds the same, for its types. An `import()`
//! type reads the name its qualifier starts with, `import('m').x.y` reads `x`;
//! with none, as in `typeof import('m')`, it names the module's type and reads
//! nothing, and what that type is written on holds the module: a cast, an
//! annotated variable or parameter, or one typed by a top-level alias of it. A
//! qualified name off a holder in a type, `typeof ns.x` or `ns.T`, reads its
//! first name, as `ns.x` does in a value.
//!
//! A named import holds the value it takes, and a name read off a holder is a
//! value inside the module too: `ns.x` after `import { ns } from 'm'`,
//! `lib.ns.x` after `import * as lib from 'm'`, in a value, a type or a JSX
//! tag. Each is a [`BindingMember`], the export it starts from and the names
//! read on the way, which the query answers only where the module passes that
//! export on as a namespace, `export * as ns`, inside one another as deep as
//! the chain goes.
//!
//! This is a listing of where a name is used, and nothing selects on it: a
//! request's `bindings` stay what the statement wrote, so a namespace still
//! reads as the whole module to anything that charges a change. A holder is the
//! binding, resolved by scope, so a parameter that reuses its name is another
//! value, and one the file writes again holds, at a read, what the writes that
//! may reach the read hold, as [`written`] says: one module, several, or none.
//! Where the module goes on whole — read as a value anywhere the walk
//! does not follow — the read is `*`: a write or a type query is not one. The
//! module's `default` is a value of the module, so it moving is a use of
//! `default` and no more; a name read off it is read through `default`.
//!
//! The same walk reads the [`Loads`]: an `import()` or a `require` is a request
//! only the tree can read, and a member read through it needs that request's
//! index, so the module's tree is walked once for both.

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;
use serde::Serialize;

use crate::loads::Loads;
use crate::read::{Lines, Request};

#[path = "members_bind.rs"]
mod bind;

#[path = "members_typed.rs"]
mod typed;

#[path = "members_held.rs"]
mod held;
use held::{Chain, Chains, Held, Via, WHOLE};

#[path = "members_passed.rs"]
mod passed;
use passed::Passing;

#[path = "members_written.rs"]
mod written;
use written::Written;

#[path = "members_visit.rs"]
mod visit;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Member {
    /// The index of the request, in the same parse, the name is read through.
    pub(crate) request: u32,
    pub(crate) name: String,
    pub(crate) line: u32,
    /// The name is read off the module's `default`, which under interop is a
    /// CommonJS module's `module.exports`: `(await import('m')).default.name`.
    #[serde(rename = "throughDefault", skip_serializing_if = "std::ops::Not::not")]
    pub(crate) through_default: bool,
}

/// A name read off a value inside a module: `ns.x` after `import { ns } from
/// 'm'`, `lib.ns.x` after `import * as lib from 'm'`, `ns.a.x` after either.
/// It reads `x` of a module only where `m` passes `ns` on as a namespace,
/// `export * as ns`, and each name of `within` names a namespace inside the
/// one before, which the query follows; off any other value it is a read the
/// type decides, and no use of a module's name.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct BindingMember {
    /// The index of the request, in the same parse, the value is read through.
    pub(crate) request: u32,
    /// The export of the module the value is, or is read off: the name a named
    /// import takes, the first name read off a namespace import, or `default`.
    pub(crate) binding: String,
    /// The names read off `binding` before `name`, nearest first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) within: Vec<String>,
    pub(crate) name: String,
    pub(crate) line: u32,
}

/// The loads a module calls for, and the names it reads off what it holds.
///
/// `requests` are the ones the module record states; a member read through an
/// `import()` is indexed as if `loads.dynamic` were appended to them, and one
/// read through a `require` as if `loads.required` followed those,
/// and one read through an `import()` type as if `loads.typed` followed those.
/// Last come the bindings a pattern destructures off a holder, by name and
/// line: the module's values under a local name, as an import binds them.
pub fn members_and_loads_in<'l>(program: &Program, scoping: &Scoping, lines: &'l Lines, requests: &[Request]) -> (Vec<Member>, Vec<BindingMember>, Loads<'l>) {
    let mut holders = HashMap::new();
    let mut chains = Chains::default();
    for (index, request) in requests.iter().enumerate() {
        // A type-only namespace or default holds the module, or its `default`, for its types.
        // A named one holds the value it takes; an `export … from` binds nothing here.
        for binding in &request.bindings {
            let held = match binding.imported.as_str() {
                "*" => Held::whole(Via::Indexed(index as u32)),
                "default" => Held::whole(Via::Indexed(index as u32)).default(),
                _ if request.republishes => continue,
                imported => Held::named(Via::Indexed(index as u32), chains.of(Chain { export: imported.to_owned(), within: Vec::new() })),
            };
            if let Some(symbol) = scoping.get_root_binding(binding.local.as_str().into()) {
                holders.insert(symbol, held);
            }
        }
    }
    let passing = Passing::of(program, scoping);
    holders.extend(passing.stand_ins());
    let mut walker = Walker {
        lines,
        scoping,
        followed: held::passed_on(program, scoping, &holders),
        holders,
        written: Written::default(),
        passing,
        chains,
        aliases: typed::aliases(program),
        typed_at: HashMap::new(),
        stated: requests.len() as u32,
        loads: Loads::new(lines, crate::loads::Requires::of(program, scoping)),
        found: BTreeSet::new(),
        mock_factory: None,
    };
    walker.visit_program(program);
    // A required request's index is known only once the walk has met every `import()`.
    let required = walker.stated + walker.loads.dynamic.len() as u32;
    let typed = required + walker.loads.required.len() as u32;
    let typed_at = &walker.typed_at;
    let passed = walker.passing.resolve();
    let mut members = BTreeSet::new();
    let mut binding_members = BTreeSet::new();
    // A read through a parameter is a read through each request handed to it.
    let found = walker.found.into_iter().flat_map(|(held, name, line)| {
        let vias: Vec<Via> = match held.via {
            Via::Param(parameter) => passed.get(&parameter).into_iter().flatten().copied().collect(),
            via => vec![via],
        };
        vias.into_iter().map(move |via| (Held { via, ..held }, name.clone(), line))
    });
    for (held, name, line) in found {
        let Some(request) = held.via.index(required, typed, typed_at) else { continue };
        match held.named {
            None => _ = members.insert(Member { request, name, line, through_default: held.off }),
            Some(at) => {
                let Chain { export, within } = walker.chains.get(at).clone();
                binding_members.insert(BindingMember { request, binding: export, within, name, line });
            }
        }
    }
    (members.into_iter().collect(), binding_members.into_iter().collect(), walker.loads)
}

struct Walker<'l, 's> {
    lines: &'l Lines,
    scoping: &'s Scoping,
    /// A binding the file never writes again to the one value it holds.
    holders: HashMap<SymbolId, Held>,
    /// What each binding the file writes again may hold.
    written: Written,
    /// The functions the module declares, and what calls hand their parameters.
    passing: Passing,
    /// The values inside a module a holder holds, which a [`Held`] names by index.
    chains: Chains,
    /// A top-level alias of `typeof import()`, to where its `import()` type starts.
    aliases: HashMap<SymbolId, u32>,
    /// Where each `import()` type the walk has met starts, to its index in `loads.typed`.
    typed_at: HashMap<u32, u32>,
    /// How many requests the record states, which the `import()` ones follow.
    stated: u32,
    loads: Loads<'l>,
    mock_factory: Option<String>,
    found: BTreeSet<(Held, String, u32)>,
    /// Where an `import()`, a `require` or a holder is read in a way the walk
    /// follows, by the offset it starts at: anywhere else, the module escapes whole.
    followed: HashSet<u32>,
}

impl Walker<'_, '_> {
    fn symbol_of(&self, it: &IdentifierReference) -> Option<SymbolId> {
        self.scoping.get_reference(it.reference_id.get()?).symbol_id()
    }

    /// A name read off what is held. Off the `default`, the value going on
    /// whole is the `default` moving, a use already recorded, and its own
    /// `default` is the same level.
    /// A named holder is a plain value far more often than a namespace, so
    /// only a name read off it by spelling is recorded: neither it going on
    /// whole nor a read off its `default`.
    fn add(&mut self, held: Held, name: &str, at: u32) {
        let named = held.named.is_some() && (held.off || name == WHOLE);
        if named || held.off && (name == WHOLE || name == "default") {
            return;
        }
        self.found.insert((held, name.to_owned(), self.lines.at(at)));
    }
}
