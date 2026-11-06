//! Where a module held whole is handed to a function the file declares.
//!
//! `f(ns)`, with `f` a function declaration or an arrow or function bound to a
//! `const`, hands the module to `f`'s parameter in that position, and what `f`
//! reads off the parameter is read off the module: the walk follows it there
//! rather than counting the argument as the module going on whole. Each
//! parameter such a function names plainly holds a stand-in, [`Via::Param`],
//! through the walk, so a function declared above its call reads the same as
//! one below it; once the walk has met every call, each stand-in is resolved
//! to the requests handed to it, through parameters handed on in turn. A
//! parameter nothing hands a module to keeps what its type says it holds, and
//! one with neither holds nothing. A parameter the function writes holds
//! something else after the write, so it is not followed: the module goes on
//! whole at the call.
//!
//! What the walk cannot pair with a parameter is the module going on whole at
//! the argument, as before: a parameter written as a pattern or a rest, a
//! position past a spread argument, a method, a function another module
//! declares, a function whose name the file assigns again. Inside the function, the parameter going anywhere the walk does
//! not follow is the module going on whole there.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashMap};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Scoping;
use oxc_syntax::scope::ScopeFlags;
use oxc_syntax::symbol::SymbolId;

use super::held::{Held, Via};
use super::Walker;

/// The functions a module declares by name, the parameters they name plainly,
/// and what reaches each parameter, by the index its stand-in carries.
#[derive(Default)]
pub(super) struct Passing {
    /// A function's binding to its parameters by position: the stand-in index
    /// of a plain one, `None` for a pattern. A rest ends the list.
    callables: HashMap<SymbolId, Vec<Option<u32>>>,
    /// Each plain parameter's binding, by stand-in index.
    parameters: Vec<SymbolId>,
    /// What a call hands each parameter, a stand-in among them.
    flows: Vec<(u32, Held)>,
    /// What a parameter's type says it holds.
    typed: HashMap<u32, Held>,
}

impl Passing {
    /// Every function `program` declares by name, wherever it is declared.
    pub(super) fn of(program: &Program, scoping: &Scoping) -> Self {
        let mut passing = Passing::default();
        Declared { passing: &mut passing, scoping }.visit_program(program);
        passing
    }

    /// Each plain parameter's binding, holding its stand-in.
    pub(super) fn stand_ins(&self) -> impl Iterator<Item = (SymbolId, Held)> + '_ {
        self.parameters.iter().enumerate().map(|(index, symbol)| (*symbol, Held::whole(Via::Param(index as u32))))
    }

    fn stand_in(&self, held: Option<Held>) -> Option<u32> {
        match held?.via {
            Via::Param(index) => Some(index),
            _ => None,
        }
    }

    /// The requests each stand-in holds: what calls hand it, carried through
    /// parameters handed on in turn, or else, when that is nothing, what its
    /// type says.
    pub(super) fn resolve(&self) -> HashMap<u32, BTreeSet<Via>> {
        let mut held: HashMap<u32, BTreeSet<Via>> = HashMap::new();
        let mut onward: HashMap<u32, Vec<u32>> = HashMap::new();
        for (parameter, from) in &self.flows {
            match from.via {
                Via::Param(source) => onward.entry(source).or_default().push(*parameter),
                via => _ = held.entry(*parameter).or_default().insert(via),
            }
        }
        let pending = held.keys().copied().collect();
        hand_on(&mut held, &onward, pending);
        let typed: Vec<u32> = self.typed.keys().copied().filter(|parameter| held.get(parameter).is_none_or(BTreeSet::is_empty)).collect();
        for parameter in &typed {
            held.entry(*parameter).or_default().insert(self.typed[parameter].via);
        }
        hand_on(&mut held, &onward, typed);
        held
    }
}

/// Carries what each of `pending` holds to the parameters it is handed on to,
/// until nothing more arrives.
fn hand_on(held: &mut HashMap<u32, BTreeSet<Via>>, onward: &HashMap<u32, Vec<u32>>, mut pending: Vec<u32>) {
    while let Some(source) = pending.pop() {
        let Some(targets) = onward.get(&source) else { continue };
        let from = held.get(&source).cloned().unwrap_or_default();
        for target in targets {
            let into = held.entry(*target).or_default();
            let before = into.len();
            into.extend(from.iter().copied());
            if into.len() != before {
                pending.push(*target);
            }
        }
    }
}

impl Walker<'_, '_> {
    /// A parameter whose type says it holds a module: a plain one keeps that
    /// for when no call hands it one, and any other is bound to it now.
    pub(super) fn typed_parameter(&mut self, parameter: &FormalParameter, held: Held) {
        let symbol = parameter.pattern.get_binding_identifier().filter(|_| matches!(parameter.pattern, BindingPattern::BindingIdentifier(_))).and_then(|it| it.symbol_id.get());
        match self.passing.stand_in(symbol.and_then(|it| self.holders.get(&it).copied())) {
            Some(index) => _ = self.passing.typed.insert(index, held),
            None => self.bind(&parameter.pattern, held),
        }
    }

    /// `f(…)` with `f` a function the file declares: each argument that is a
    /// module held whole goes to the parameter in its position, and is no
    /// longer the module going on whole.
    pub(super) fn pass(&mut self, call: &CallExpression) {
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else { return };
        let Some(parameters) = self.symbol_of(callee).and_then(|it| self.passing.callables.get(&it)).cloned() else { return };
        for (argument, parameter) in call.arguments.iter().zip(parameters) {
            let Some(argument) = argument.as_expression() else { break };
            let Some(parameter) = parameter else { continue };
            if !matches!(argument.get_inner_expression(), Expression::Identifier(_) | Expression::AwaitExpression(_)) {
                continue;
            }
            if let Some(held) = self.held(argument).filter(|held| held.named.is_none() && !held.off) {
                self.passing.flows.push((parameter, held));
            }
        }
    }
}

/// The walk that finds the functions a module declares by name.
struct Declared<'p> {
    passing: &'p mut Passing,
    scoping: &'p Scoping,
}

impl Declared<'_> {
    fn declare(&mut self, binding: &BindingIdentifier, params: &FormalParameters) {
        let Some(symbol) = binding.symbol_id.get().filter(|symbol| !self.scoping.symbol_is_mutated(*symbol)) else { return };
        let positions = params
            .items
            .iter()
            .map(|parameter| match &parameter.pattern {
                BindingPattern::BindingIdentifier(it) => it.symbol_id.get().filter(|symbol| !self.scoping.symbol_is_mutated(*symbol)).map(|symbol| {
                    self.passing.parameters.push(symbol);
                    self.passing.parameters.len() as u32 - 1
                }),
                _ => None,
            })
            .collect();
        self.passing.callables.insert(symbol, positions);
    }
}

impl<'a> Visit<'a> for Declared<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if let (true, Some(id), Some(_)) = (it.is_declaration(), &it.id, &it.body) {
            self.declare(id, &it.params);
        }
        walk::walk_function(self, it, flags);
    }

    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        if it.kind == VariableDeclarationKind::Const {
            for declarator in &it.declarations {
                let (BindingPattern::BindingIdentifier(id), Some(init)) = (&declarator.id, &declarator.init) else { continue };
                match init.get_inner_expression() {
                    Expression::ArrowFunctionExpression(f) => self.declare(id, &f.params),
                    Expression::FunctionExpression(f) if f.body.is_some() => self.declare(id, &f.params),
                    _ => {}
                }
            }
        }
        walk::walk_variable_declaration(self, it);
    }
}
