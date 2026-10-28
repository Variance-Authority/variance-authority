//! What a binding the walk follows holds, the request it reads through, and
//! what a name read off it holds.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{Argument, ArrayExpression, Expression, JSXMemberExpressionObject, ModuleExportName, Program, Statement, TSTypeName};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

use super::Walker;

/// The request a holder reads through: its index in the parse, its index in
/// `loads.required`, which the parse appends after every `import()`, or its
/// index in `loads.typed`, which the parse appends after those, or the
/// `import()` type starting at an offset, whose index the walk may meet later;
/// or the parameter of a function the file declares, by its index in
/// `Passing`, which stands in for the requests handed to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Via {
    Indexed(u32),
    Required(u32),
    Typed(u32),
    TypedAt(u32),
    Param(u32),
}

impl Via {
    /// The request's index in the parse; a parameter's stand-in has none until it is resolved.
    pub(super) fn index(self, required: u32, typed: u32, typed_at: &HashMap<u32, u32>) -> Option<u32> {
        Some(match self {
            Via::Indexed(index) => index,
            Via::Required(index) => required + index,
            Via::Typed(index) => typed + index,
            Via::TypedAt(at) => typed + typed_at.get(&at)?,
            Via::Param(_) => return None,
        })
    }
}

/// What a value holds: the module a request loads, or, `off`, that module's
/// `default`; or, `named`, a value inside the module, by its index in the
/// walk's [`Chains`]: an export of it, as a named import takes one, or a
/// member read off one, as `ns.a` holds `a` and `ns.a.b` holds `b` of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Held {
    pub(super) via: Via,
    pub(super) off: bool,
    pub(super) named: Option<u32>,
}

/// A value inside a module: the export it is, and the names read off that
/// export to reach it, nearest first.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct Chain {
    pub(super) export: String,
    pub(super) within: Vec<String>,
}

/// Every [`Chain`] a holder in one module holds, each once, by index.
#[derive(Default)]
pub(super) struct Chains {
    held: Vec<Chain>,
    at: HashMap<Chain, u32>,
}

impl Chains {
    pub(super) fn of(&mut self, chain: Chain) -> u32 {
        if let Some(&index) = self.at.get(&chain) {
            return index;
        }
        let index = self.held.len() as u32;
        self.at.insert(chain.clone(), index);
        self.held.push(chain);
        index
    }

    pub(super) fn get(&self, index: u32) -> &Chain {
        &self.held[index as usize]
    }
}

impl Held {
    pub(super) fn whole(via: Via) -> Self {
        Held { via, off: false, named: None }
    }

    /// The value at `chain` inside the module: an export a named import
    /// takes, or a member read off one. Which names a read off it reaches is
    /// the module's to say only when the value is a namespace it passes on,
    /// which the query decides.
    pub(super) fn named(via: Via, chain: u32) -> Self {
        Held { via, off: false, named: Some(chain) }
    }

    /// The module's `default`. Interop nests one level, so the `default` of
    /// a `default` is the same level: `ns.default.default.x` reads `x` through it.
    pub(super) fn default(self) -> Self {
        Held { off: true, ..self }
    }
}

/// The token a member read takes when the module goes somewhere the walk does
/// not follow, as a binding takes it for the namespace whole.
pub(super) const WHOLE: &str = "*";

/// Where a namespace import is exported by its local name, `export { g }`
/// after `import * as g from 'm'`. The parse records that as `export * as g
/// from 'm'`, which the query follows, so the reference passes the module on
/// and is no read of it whole.
pub(super) fn passed_on(program: &Program, scoping: &Scoping, holders: &HashMap<SymbolId, Held>) -> HashSet<u32> {
    let mut followed = HashSet::new();
    for statement in &program.body {
        let Statement::ExportNamedDeclaration(it) = statement else { continue };
        for specifier in &it.specifiers {
            let ModuleExportName::IdentifierReference(local) = &specifier.local else { continue };
            let symbol = local.reference_id.get().and_then(|it| scoping.get_reference(it).symbol_id());
            // Before the walk, a holder of the whole module is a namespace import.
            if symbol.and_then(|it| holders.get(&it)).is_some_and(|held| held.named.is_none() && !held.off) {
                followed.insert(local.span.start);
            }
        }
    }
    followed
}

impl Walker<'_, '_> {
    /// The value `name` read off what `held` holds: an export of the module,
    /// a member of the module's `default`, or a member of a value inside it.
    /// A read off a value's `default` is the type's to say.
    pub(super) fn member_of(&mut self, held: Held, name: &str) -> Option<Held> {
        let chain = match held.named {
            Some(_) if held.off => return None,
            Some(at) => {
                let Chain { export, within } = self.chains.get(at);
                Chain { export: export.clone(), within: within.iter().cloned().chain([name.to_owned()]).collect() }
            }
            None if held.off => Chain { export: "default".to_owned(), within: vec![name.to_owned()] },
            None => Chain { export: name.to_owned(), within: Vec::new() },
        };
        Some(Held::named(held.via, self.chains.of(chain)))
    }

    /// What the object of a JSX member expression holds, `lib.ns` in `<lib.ns.X />`.
    pub(super) fn jsx_held(&mut self, object: &JSXMemberExpressionObject) -> Option<Held> {
        match object {
            JSXMemberExpressionObject::IdentifierReference(it) => {
                let held = self.holder(it)?;
                self.followed.insert(it.span.start);
                Some(held)
            }
            JSXMemberExpressionObject::MemberExpression(it) => {
                let held = self.jsx_held(&it.object)?;
                self.member_of(held, &it.property.name)
            }
            JSXMemberExpressionObject::ThisExpression(_) => None,
        }
    }

    /// What the left of a qualified name holds, `lib.ns` in `lib.ns.T`.
    pub(super) fn qualified_held(&mut self, name: &TSTypeName) -> Option<Held> {
        match name {
            TSTypeName::IdentifierReference(it) => {
                self.followed.insert(it.span.start);
                self.holder(it)
            }
            TSTypeName::QualifiedName(it) => {
                let held = self.qualified_held(&it.left)?;
                self.member_of(held, &it.right.name)
            }
            _ => None,
        }
    }
}

/// The promise an expression hands on: `.catch(…)` and `.finally(…)` settle
/// to the same module, so `import('m').catch(…)` is still `import('m')`.
pub(super) fn handed_on<'e, 'a>(expression: &'e Expression<'a>) -> &'e Expression<'a> {
    let mut expression = expression.get_inner_expression();
    while let Expression::CallExpression(call) = expression {
        let Expression::StaticMemberExpression(callee) = call.callee.get_inner_expression() else { break };
        if !matches!(callee.property.name.as_str(), "catch" | "finally") {
            break;
        }
        expression = callee.object.get_inner_expression();
    }
    expression
}

/// The array of `Promise.all([...])`.
pub(super) fn all_of<'e, 'a>(expression: &'e Expression<'a>) -> Option<&'e ArrayExpression<'a>> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else { return None };
    if !call.callee.get_inner_expression().is_specific_member_access("Promise", "all") {
        return None;
    }
    match call.arguments.first() {
        Some(Argument::ArrayExpression(array)) => Some(array),
        _ => None,
    }
}
