//! What a binding the file writes again holds at a read: the set of values
//! the writes that may reach the read hold, reaching definitions over the
//! file's structured code, in the one walk that reads the members.
//!
//! A write takes away what the binding held only where it surely runs once its
//! statement does: a statement of its own, an element of one's sequence, what a
//! plain `=` there assigns, a declaration. Anywhere else it only adds. At `if`
//! and `?:` each path starts from what was held there, and where they meet,
//! what each holds is joined. A `break`, a `continue` or a throw carries what is
//! held out of a loop, a `switch`, a label or a `try` from anywhere in it, past
//! the writes below it, so a write inside one only adds too. A function may run
//! at any time: a write inside one adds to what the binding holds from there
//! on, which no later write takes away, and a read inside one sees everything
//! the binding was given above it, as a type query does.
//!
//! A write below a read is not followed back up to it, round a loop or into a
//! function declared above it. A binding that is never written again, and is
//! given one value, keeps it in `holders`.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_ast::ast::{Expression, IdentifierReference};
use oxc_syntax::scope::ScopeId;
use oxc_syntax::symbol::SymbolId;

use super::{Held, Walker};

/// What each binding the walk follows may hold.
type State = HashMap<SymbolId, BTreeSet<Held>>;

/// What each binding the file writes again holds.
#[derive(Default)]
pub(super) struct Written {
    /// What it may hold where the walk is, in the function that declares it.
    now: State,
    /// What a write inside a function gave it, which may run after any write.
    anytime: State,
    /// Everything it has been given, which a read inside a function sees.
    ever: State,
    /// How many loops, `switch`es, labels and `try`s the walk is in.
    leaving: u32,
    /// The writes that surely run where they stand, by where each starts.
    sure: HashSet<u32>,
}

impl Walker<'_, '_> {
    /// What a reference's binding may hold where it is read.
    pub(super) fn holder(&self, it: &IdentifierReference) -> Vec<Held> {
        let Some(reference) = it.reference_id.get().map(|it| self.scoping.get_reference(it)) else { return Vec::new() };
        reference.symbol_id().map_or_else(Vec::new, |symbol| self.holding(symbol, Some(reference.scope_id())))
    }

    /// What `symbol` may hold read `at` a scope, or, with none, from outside
    /// the flow, which sees everything it was given.
    pub(super) fn holding(&self, symbol: SymbolId, at: Option<ScopeId>) -> Vec<Held> {
        if let Some(held) = self.holders.get(&symbol) {
            return vec![*held];
        }
        let written = &self.written;
        let Some(ever) = written.ever.get(&symbol) else { return Vec::new() };
        match at {
            Some(at) if !self.elsewhere(symbol, at) => {
                let held: BTreeSet<Held> = [&written.now, &written.anytime].into_iter().filter_map(|it| it.get(&symbol)).flatten().copied().collect();
                held.into_iter().collect()
            }
            _ => ever.iter().copied().collect(),
        }
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
        if !self.elsewhere(symbol, reference.scope_id()) {
            return self.give(symbol, held, adds);
        }
        if !held.is_empty() {
            self.written.anytime.entry(symbol).or_default().extend(held);
            self.written.ever.entry(symbol).or_default().extend(held);
        }
    }

    fn give(&mut self, symbol: SymbolId, held: &[Held], adds: bool) {
        let written = &mut self.written;
        if held.is_empty() && !written.ever.contains_key(&symbol) {
            return;
        }
        written.ever.entry(symbol).or_default().extend(held);
        let now = written.now.entry(symbol).or_default();
        if !adds && written.leaving == 0 {
            now.clear();
        }
        now.extend(held);
    }

    /// Whether a function lies between scope `at` and the one declaring `symbol`.
    fn elsewhere(&self, symbol: SymbolId, at: ScopeId) -> bool {
        let home = self.scoping.symbol_scope_id(symbol);
        self.scoping.scope_ancestors(at).take_while(|scope| *scope != home).any(|scope| self.scoping.scope_flags(scope).is_function())
    }

    /// Marks the writes `expression` makes whenever it runs as writes that
    /// surely run: an assignment, each of a sequence, and what a plain `=`
    /// assigns. The right of `??=`, `||=` and `&&=` may not run.
    pub(super) fn surely(&mut self, expression: &Expression) {
        match expression.get_inner_expression() {
            Expression::SequenceExpression(it) => it.expressions.iter().for_each(|it| self.surely(it)),
            Expression::AssignmentExpression(it) => {
                self.written.sure.insert(it.span.start);
                if !it.operator.is_logical() {
                    self.surely(&it.right);
                }
            }
            _ => {}
        }
    }

    /// Whether the assignment starting at `at` surely runs where it stands.
    pub(super) fn sure(&mut self, at: u32) -> bool {
        self.written.sure.remove(&at)
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

    /// Runs `run`, a loop, a `switch`, a label or a `try`, out of which a jump
    /// or a throw may leave from anywhere: a write inside it only adds.
    pub(super) fn leaving(&mut self, run: impl FnOnce(&mut Self)) {
        self.written.leaving += 1;
        run(self);
        self.written.leaving -= 1;
    }
}
