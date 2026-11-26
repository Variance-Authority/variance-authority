//! Where a module a walk holds is bound or assigned: to a name, or through a
//! pattern that destructures it.

use oxc_ast::ast::*;
use oxc_ast_visit::walk;

use super::{Held, Via, Walker, WHOLE};

impl Walker<'_, '_> {
    /// What binding a pattern to `held` takes: a holder, or the names it
    /// destructures, each holding the value it takes as `held.name` would,
    /// and a rest holds what the names left. `default` destructured further
    /// holds the module's default; a key the walk cannot spell, or an array
    /// pattern, reads the module whole. `held` is each value it may be.
    pub(super) fn bind(&mut self, pattern: &BindingPattern, held: &[Held]) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => self.hold(it.symbol_id.get(), held),
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    let name = property.key.static_name().and_then(|name| name.into_cow_str());
                    let taken = self.taken(held, name.as_deref(), property.span.start);
                    if !taken.is_empty() {
                        self.bind(&property.value, &taken);
                    }
                }
                if let Some(rest) = &it.rest {
                    self.bind(&rest.argument, held);
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, held),
            BindingPattern::ArrayPattern(it) => self.whole(held, it.span.start),
        }
    }

    /// Binding a pattern to what `Promise.all` resolves to: element `i` of the
    /// pattern takes the request element `i` of the array holds, and a rest, or
    /// a pattern that is not an array, holds the modules it gets whole.
    pub(super) fn bind_all(&mut self, pattern: &BindingPattern, held: &[Option<Via>]) {
        let pattern = match pattern {
            BindingPattern::AssignmentPattern(it) => &it.left,
            other => other,
        };
        let BindingPattern::ArrayPattern(array) = pattern else {
            let at = oxc_span::GetSpan::span(pattern).start;
            for request in held.iter().flatten() {
                self.add(Held::whole(*request), WHOLE, at);
            }
            return;
        };
        for (index, request) in held.iter().enumerate() {
            let Some(request) = *request else { continue };
            match (array.elements.get(index), &array.rest) {
                (Some(Some(element)), _) => self.bind(element, &[Held::whole(request)]),
                (None, Some(rest)) => self.add(Held::whole(request), WHOLE, rest.span.start),
                _ => {}
            }
        }
    }

    /// An assignment. What its right side holds is read before the walk goes
    /// into it and written after, so `m = m.next` reads `next` off what `m`
    /// held. `=` writes a name in place of what it held, a value that is not a
    /// module among them, where it surely runs, and beside it anywhere else;
    /// `??=`, `||=` and `&&=` may not run, so they only add. A pattern takes
    /// only a module, and the name tested is not read whole.
    pub(super) fn assignment<'a>(&mut self, it: &AssignmentExpression<'a>) {
        let named = match &it.left {
            AssignmentTarget::AssignmentTargetIdentifier(target) => Some(&**target),
            _ => None,
        };
        let replaces = it.operator == AssignmentOperator::Assign && takes(&it.left);
        let logical = it.operator.is_logical() && named.is_some();
        let adds = !self.sure(it.span.start) || logical;
        let all = if replaces { self.held_all(&it.right) } else { None };
        let held = if all.is_none() && (replaces || logical) { self.held(&it.right) } else { Vec::new() };
        if let Some(target) = named.filter(|_| logical) {
            self.followed.insert(target.span.start);
        }
        walk::walk_assignment_expression(self, it);
        if let Some(all) = &all {
            self.assign_all(&it.left, all, adds);
        }
        match named {
            Some(target) if replaces || logical => self.write(target, &held, adds),
            _ if replaces && !held.is_empty() => self.assign(&it.left, &held, adds),
            _ => {}
        }
    }

    /// `bind` for an assignment, whose target is a reference rather than a
    /// declaration, or a property, where the module goes on whole; `adds`,
    /// beside what the reference held, for an assignment that may not run.
    pub(super) fn assign(&mut self, target: &AssignmentTarget, held: &[Held], adds: bool) {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(it) => {
                self.followed.insert(it.span.start);
                self.write(it, held, adds);
            }
            AssignmentTarget::ObjectAssignmentTarget(it) => {
                for property in &it.properties {
                    match property {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(it) => {
                            let taken = self.taken(held, Some(&it.binding.name), it.span.start);
                            if !taken.is_empty() {
                                self.write(&it.binding, &taken, adds);
                            }
                        }
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(it) => {
                            let name = it.name.static_name().and_then(|name| name.into_cow_str());
                            let taken = self.taken(held, name.as_deref(), it.span.start);
                            if let (Some(target), false) = (target_of(&it.binding), taken.is_empty()) {
                                self.assign(target, &taken, adds);
                            }
                        }
                    }
                }
                if let Some(rest) = &it.rest {
                    self.assign(&rest.target, held, adds);
                }
            }
            AssignmentTarget::ArrayAssignmentTarget(it) => self.whole(held, it.span.start),
            // A property, `o.rest`, stores the module where the walk does not follow it.
            other => self.whole(held, oxc_span::GetSpan::span(other).start),
        }
    }

    /// `bind_all` for an assignment.
    pub(super) fn assign_all(&mut self, target: &AssignmentTarget, held: &[Option<Via>], adds: bool) {
        let AssignmentTarget::ArrayAssignmentTarget(array) = target else {
            let at = oxc_span::GetSpan::span(target).start;
            for request in held.iter().flatten() {
                self.add(Held::whole(*request), WHOLE, at);
            }
            return;
        };
        for (index, request) in held.iter().enumerate() {
            let Some(request) = *request else { continue };
            match (array.elements.get(index), &array.rest) {
                (Some(Some(element)), _) => {
                    if let Some(target) = target_of(element) {
                        self.assign(target, &[Held::whole(request)], adds);
                    }
                }
                (None, Some(rest)) => self.add(Held::whole(request), WHOLE, rest.span.start),
                _ => {}
            }
        }
    }
}

impl Walker<'_, '_> {
    /// What the name a pattern destructures off `held` holds.
    fn destructured(&mut self, held: Held, name: &str) -> Option<Held> {
        if name == "default" { Some(held.default()) } else { self.member_of(held, name) }
    }

    /// Reads `name` off each of `held` at `at`, and what it holds there; with
    /// no name the walk can spell, each goes on whole.
    fn taken(&mut self, held: &[Held], name: Option<&str>, at: u32) -> Vec<Held> {
        let Some(name) = name else {
            self.whole(held, at);
            return Vec::new();
        };
        let mut taken = Vec::new();
        for held in held {
            self.add(*held, name, at);
            taken.extend(self.destructured(*held, name));
        }
        taken
    }

    fn whole(&mut self, held: &[Held], at: u32) {
        for held in held {
            self.add(*held, WHOLE, at);
        }
    }
}

/// The target an assignment pattern's element writes, past its default.
fn target_of<'e, 'a>(element: &'e AssignmentTargetMaybeDefault<'a>) -> Option<&'e AssignmentTarget<'a>> {
    match element {
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(it) => Some(&it.binding),
        other => other.as_assignment_target(),
    }
}

/// A destructuring target that can take a module: a name, or a pattern.
pub(super) fn takes(target: &AssignmentTarget) -> bool {
    matches!(
        target,
        AssignmentTarget::AssignmentTargetIdentifier(_) | AssignmentTarget::ObjectAssignmentTarget(_) | AssignmentTarget::ArrayAssignmentTarget(_)
    )
}
