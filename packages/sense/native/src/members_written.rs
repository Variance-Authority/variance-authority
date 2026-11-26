//! What a binding the file writes again holds at a read: the set of values
//! the writes that may reach the read hold, reaching definitions over the
//! file's structured code.
//!
//! A write that is a statement of a list holds for the rest of that list, and
//! when the list ends the binding holds what it held at the list's start as
//! well. A write in a statement that may not run — a branch, a loop's body, the
//! right of `&&`, `||` or `??`, a `??=` — only adds, and `else` starts from
//! what was held before `if`. A function may run at any time: a write inside
//! one adds to what the binding holds from there on, which no later write takes
//! away, and a read inside one sees everything the binding was given above it.
//! A write of a value that is not a module on every path leaves the binding
//! holding nothing. A binding that is never written again keeps the one value
//! it was given, in `holders`.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashMap};

use oxc_ast::ast::IdentifierReference;
use oxc_syntax::scope::ScopeId;
use oxc_syntax::symbol::SymbolId;

use super::{Held, Walker};

/// What each binding the file writes again holds.
#[derive(Default)]
pub(super) struct Written {
    /// What it may hold where the walk is, in the function that declares it.
    now: HashMap<SymbolId, BTreeSet<Held>>,
    /// What a write inside another function gave it, which may run after any write.
    anytime: HashMap<SymbolId, BTreeSet<Held>>,
    /// Everything it has been given, which a read inside another function sees.
    ever: HashMap<SymbolId, BTreeSet<Held>>,
}

impl Walker<'_, '_> {
    /// What a reference's binding may hold where it is read.
    pub(super) fn holder(&self, it: &IdentifierReference) -> Vec<Held> {
        let Some(reference) = it.reference_id.get().map(|it| self.scoping.get_reference(it)) else { return Vec::new() };
        reference.symbol_id().map_or_else(Vec::new, |symbol| self.holding(symbol, Some(reference.scope_id())))
    }

    /// What `symbol` may hold read `at` a scope, or, with none, from outside
    /// the file, which sees everything it was given.
    pub(super) fn holding(&self, symbol: SymbolId, at: Option<ScopeId>) -> Vec<Held> {
        if let Some(held) = self.holders.get(&symbol) {
            return vec![*held];
        }
        let Some(ever) = self.written.ever.get(&symbol) else { return Vec::new() };
        let held = if at.is_some_and(|at| !self.elsewhere(symbol, at)) { self.written.now.get(&symbol) } else { Some(ever) };
        held.map_or_else(Vec::new, |held| held.iter().copied().collect())
    }

    /// Binds a declaration to what it holds.
    pub(super) fn hold(&mut self, symbol: Option<SymbolId>, held: &[Held]) {
        let Some(symbol) = symbol else { return };
        match held {
            [one] if !self.scoping.symbol_is_mutated(symbol) => _ = self.holders.insert(symbol, *one),
            _ => self.give(symbol, held, false),
        }
    }

    /// Writes `held` to the binding a reference names: in place of what it
    /// held, or, `adds`, beside it, for a write that may not run.
    pub(super) fn write(&mut self, target: &IdentifierReference, held: &[Held], adds: bool) {
        let Some(reference) = target.reference_id.get().map(|it| self.scoping.get_reference(it)) else { return };
        let Some(symbol) = reference.symbol_id() else { return };
        if held.is_empty() && !self.written.ever.contains_key(&symbol) {
            return;
        }
        let elsewhere = self.elsewhere(symbol, reference.scope_id());
        if elsewhere {
            self.written.anytime.entry(symbol).or_default().extend(held);
        }
        self.give(symbol, held, adds || elsewhere);
    }

    fn give(&mut self, symbol: SymbolId, held: &[Held], adds: bool) {
        let written = &mut self.written;
        if held.is_empty() && !written.ever.contains_key(&symbol) {
            return;
        }
        written.ever.entry(symbol).or_default().extend(held);
        let now = written.now.entry(symbol).or_default();
        if !adds {
            now.clear();
            now.extend(written.anytime.get(&symbol).into_iter().flatten());
        }
        now.extend(held);
    }

    /// Whether a function lies between scope `at` and the one declaring `symbol`.
    fn elsewhere(&self, symbol: SymbolId, at: ScopeId) -> bool {
        let home = self.scoping.symbol_scope_id(symbol);
        self.scoping.scope_ancestors(at).take_while(|scope| *scope != home).any(|scope| self.scoping.scope_flags(scope).is_function())
    }

    /// Runs `one`, then `other` from what was held before `one`, and holds
    /// what either leaves: two paths, only one of which runs.
    pub(super) fn either(&mut self, one: impl FnOnce(&mut Self), other: impl FnOnce(&mut Self)) {
        let start = self.written.now.clone();
        one(self);
        let first = std::mem::replace(&mut self.written.now, start);
        other(self);
        for (symbol, held) in first {
            self.written.now.entry(symbol).or_default().extend(held);
        }
    }

    /// Runs `path`, which may not run, or may stop part way.
    pub(super) fn may_skip(&mut self, path: impl FnOnce(&mut Self)) {
        self.either(path, |_| {});
    }
}
