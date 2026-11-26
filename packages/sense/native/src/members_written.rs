//! What a binding the file writes again holds at a read: the set of values
//! the writes that may reach the read hold, reaching definitions over the
//! file's structured code.
//!
//! A write takes away what the binding held only where it surely runs once its
//! statement does: a statement of its own, a `for` init, a declaration.
//! Anywhere else it only adds. Where paths part, each starts from what was
//! held there, and where they meet, what each holds is joined. A loop's head
//! holds what was held before the loop and at its body's end; its body may not
//! run, `do … while`'s aside. `break` carries what is held to where its loop,
//! `switch` or label ends, and `continue` to the loop's head. A `catch` starts
//! from anything its `try` held. A function or an instance field's value may
//! run at any time: a write inside one reaches every read in the function that
//! declares the binding, and a read inside one sees everything the binding is
//! given, as an importer of an exported binding and a type query do.
//!
//! A read can sit above a write that reaches it, in a loop or below a
//! function, so a file that gives any of these bindings a module is walked
//! twice, the second time from everything the first gave. A binding that is
//! never written again, and is given one value, keeps it in `holders`.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_ast::ast::{Expression, IdentifierReference, SwitchStatement, TryStatement};
use oxc_ast_visit::Visit;
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
    /// What a write inside a function or an instance field gave it.
    anytime: State,
    /// Everything it is given.
    ever: State,
    /// What each loop's body held at its end, by where the loop starts.
    looped: HashMap<u32, State>,
    /// The loops, `switch`es and labels the walk is in, innermost last.
    targets: Vec<Target>,
    /// What each `try` the walk is in has given so far, innermost last.
    tried: Vec<State>,
    /// The writes that surely run where they stand, by where each starts.
    sure: HashSet<u32>,
    /// The class bodies the walk is in, innermost last.
    classes: Vec<Option<ScopeId>>,
    /// The class bodies whose instance field's value the walk is in.
    later: Vec<ScopeId>,
}

impl Written {
    /// Whether the file gave a binding it writes again a module, which a
    /// second walk then reads with everything this one gave.
    pub(super) fn again(&self) -> bool {
        !self.ever.is_empty()
    }

    /// What a second walk starts from: everything each binding was given,
    /// and what each loop's body held at its end, which its head holds again.
    pub(super) fn settled(self) -> Self {
        Written { anytime: self.anytime, ever: self.ever, looped: self.looped, ..Written::default() }
    }
}

impl Walker<'_, '_> {
    /// What a reference's binding may hold where it is read.
    pub(super) fn holder(&self, it: &IdentifierReference) -> Vec<Held> {
        let Some(reference) = it.reference_id.get().map(|it| self.scoping.get_reference(it)) else { return Vec::new() };
        reference.symbol_id().map_or_else(Vec::new, |symbol| self.holding(symbol, Some(reference.scope_id())))
    }

    /// What `symbol` may hold read `at` a scope, or, with none, from outside
    /// the file or the flow, which sees everything it is given.
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
        for tried in &mut written.tried {
            tried.entry(symbol).or_default().extend(held);
        }
        let now = written.now.entry(symbol).or_default();
        if !adds {
            now.clear();
        }
        now.extend(held);
    }

    /// Whether code that may run at any time, a function or an instance
    /// field's value, lies between scope `at` and the one declaring `symbol`.
    fn elsewhere(&self, symbol: SymbolId, at: ScopeId) -> bool {
        let home = self.scoping.symbol_scope_id(symbol);
        let later = |scope: ScopeId| self.scoping.scope_flags(scope).is_function() || self.written.later.contains(&scope);
        self.scoping.scope_ancestors(at).take_while(|scope| *scope != home).any(later)
    }

    /// Marks the writes `expression` makes whenever it runs as writes that
    /// surely run: an assignment, each of a sequence, and what one assigns.
    pub(super) fn surely(&mut self, expression: &Expression) {
        match expression.get_inner_expression() {
            Expression::SequenceExpression(it) => it.expressions.iter().for_each(|it| self.surely(it)),
            Expression::AssignmentExpression(it) => {
                self.written.sure.insert(it.span.start);
                self.surely(&it.right);
            }
            _ => {}
        }
    }

    /// Whether the assignment starting at `at` surely runs where it stands.
    pub(super) fn sure(&mut self, at: u32) -> bool {
        self.written.sure.remove(&at)
    }
}

/// A loop, a `switch` or a label a `break` inside it leaves, and, a loop,
/// the head a `continue` inside it goes back to.
#[derive(Default)]
struct Target {
    loops: bool,
    label: Option<String>,
    breaks: State,
    continues: State,
}

impl Walker<'_, '_> {
    /// Runs `one`, then `other` from what was held before `one`, and holds
    /// what either leaves: two paths, only one of which runs.
    pub(super) fn either(&mut self, one: impl FnOnce(&mut Self), other: impl FnOnce(&mut Self)) {
        let start = self.written.now.clone();
        one(self);
        let first = std::mem::replace(&mut self.written.now, start);
        other(self);
        self.join(first);
    }

    /// Runs `path`, which may not run.
    pub(super) fn may_skip(&mut self, path: impl FnOnce(&mut Self)) {
        self.either(path, |_| {});
    }

    /// A loop starting at `at`: `head` each time round, from what was held
    /// before the loop or at the end of its body the time before, then
    /// `body`, which may not run unless `once`, and `next` after it.
    pub(super) fn looping(&mut self, at: u32, once: bool, head: impl FnOnce(&mut Self), body: impl FnOnce(&mut Self), next: impl FnOnce(&mut Self)) {
        if let Some(round) = self.written.looped.get(&at).cloned() {
            self.join(round);
        }
        head(self);
        let mut left = State::default();
        let round = |walker: &mut Self| {
            let Target { breaks, continues, .. } = walker.leaving(Target { loops: true, ..Target::default() }, body);
            walker.join(continues);
            next(walker);
            if !walker.written.now.is_empty() {
                walker.written.looped.insert(at, walker.written.now.clone());
            }
            left = breaks;
        };
        if once { round(self) } else { self.may_skip(round) }
        self.join(left);
    }

    /// A label: a `break` naming it goes to where it ends.
    pub(super) fn labeled(&mut self, label: &str, body: impl FnOnce(&mut Self)) {
        let Target { breaks, .. } = self.leaving(Target { label: Some(label.to_owned()), ..Target::default() }, body);
        self.join(breaks);
    }

    /// A `switch`: each case is entered from it or from the case above, and
    /// with no `default` none may run.
    pub(super) fn switching(&mut self, it: &SwitchStatement) {
        self.visit_expression(&it.discriminant);
        let start = self.written.now.clone();
        let Target { breaks, .. } = self.leaving(Target::default(), |walker| {
            for case in &it.cases {
                walker.join(start.clone());
                walker.visit_switch_case(case);
            }
        });
        if it.cases.iter().all(|case| case.test.is_some()) {
            self.join(start);
        }
        self.join(breaks);
    }

    /// `break`, or, `continues`, `continue`, to the statement `label` names
    /// or, with none, the innermost loop or `switch`: what is held goes where
    /// it jumps, and none of it reaches the code after it.
    pub(super) fn jump(&mut self, continues: bool, label: Option<&str>) {
        let targets = &mut self.written.targets;
        let named = match label {
            Some(label) => targets.iter().rposition(|it| it.label.as_deref() == Some(label)),
            None => targets.iter().rposition(|it| it.label.is_none() && (it.loops || !continues)),
        };
        // A labelled `continue` goes to the loop its label, or labels, stand on.
        let Some(target) = named.and_then(|at| if continues { targets[at..].iter_mut().find(|it| it.loops) } else { targets.get_mut(at) }) else { return };
        let now = std::mem::take(&mut self.written.now);
        merge(if continues { &mut target.continues } else { &mut target.breaks }, now);
    }

    /// A `try`: its `catch` starts from anything the `try` held, and
    /// `finally` from anything either held.
    pub(super) fn trying(&mut self, it: &TryStatement) {
        let mut held = self.written.now.clone();
        let tried = self.tracing(|walker| walker.visit_block_statement(&it.block));
        merge(&mut held, tried);
        if let Some(handler) = &it.handler {
            let ended = std::mem::replace(&mut self.written.now, held.clone());
            let caught = self.tracing(|walker| walker.visit_catch_clause(handler));
            merge(&mut held, caught);
            self.join(ended);
        }
        if let Some(finalizer) = &it.finalizer {
            self.join(held);
            self.visit_block_statement(finalizer);
        }
    }

    /// A class body, whose instance fields' values run at `new`.
    pub(super) fn class(&mut self, scope: Option<ScopeId>, body: impl FnOnce(&mut Self)) {
        self.written.classes.push(scope);
        body(self);
        self.written.classes.pop();
    }

    /// A member of the class body the walk is in: an `instance` one's value
    /// runs at `new`, and so may run at any time.
    pub(super) fn member(&mut self, instance: bool, run: impl FnOnce(&mut Self)) {
        let later = self.written.classes.last().copied().flatten().filter(|_| instance);
        self.written.later.extend(later);
        run(self);
        if later.is_some() {
            self.written.later.pop();
        }
    }

    /// Runs `run` inside `target`, a loop, a `switch` or a label, and what
    /// its `break`s and `continue`s carried.
    fn leaving(&mut self, target: Target, run: impl FnOnce(&mut Self)) -> Target {
        self.written.targets.push(target);
        run(self);
        self.written.targets.pop().unwrap_or_default()
    }

    /// Runs `run`, and what it gave each binding.
    fn tracing(&mut self, run: impl FnOnce(&mut Self)) -> State {
        self.written.tried.push(State::default());
        run(self);
        self.written.tried.pop().unwrap_or_default()
    }

    fn join(&mut self, state: State) {
        merge(&mut self.written.now, state);
    }
}

fn merge(into: &mut State, from: State) {
    for (symbol, held) in from {
        into.entry(symbol).or_default().extend(held);
    }
}
