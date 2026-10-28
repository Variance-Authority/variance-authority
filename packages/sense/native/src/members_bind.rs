//! Where a module a walk holds is bound or assigned: to a name, or through a
//! pattern that destructures it.

use oxc_ast::ast::*;

use super::{Held, Via, Walker, WHOLE};

impl Walker<'_, '_> {
    /// What binding a pattern to `held` takes: a holder, or the names it
    /// destructures, each holding the value it takes as `held.name` would,
    /// and a rest holds what the names left. `default` destructured further
    /// holds the module's default; a key the walk cannot spell, or an array
    /// pattern, reads the module whole.
    pub(super) fn bind(&mut self, pattern: &BindingPattern, held: Held) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => self.hold(it.symbol_id.get(), held),
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    let Some(name) = property.key.static_name() else {
                        self.add(held, WHOLE, property.span.start);
                        continue;
                    };
                    self.add(held, &name, property.span.start);
                    if let Some(taken) = self.destructured(held, &name) {
                        let top = |it: &BindingIdentifier| it.symbol_id.get().is_some_and(|id| self.scoping.symbol_scope_id(id) == self.scoping.root_scope_id());
                        if let Some(binding) = property.value.get_binding_identifier().filter(|it| top(it)) {
                            self.taken.insert((binding.name.to_string(), self.lines.at(binding.span.start)));
                        }
                        self.bind(&property.value, taken);
                    }
                }
                if let Some(rest) = &it.rest {
                    self.bind(&rest.argument, held);
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, held),
            BindingPattern::ArrayPattern(it) => self.add(held, WHOLE, it.span.start),
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
                (Some(Some(element)), _) => self.bind(element, Held::whole(request)),
                (None, Some(rest)) => self.add(Held::whole(request), WHOLE, rest.span.start),
                _ => {}
            }
        }
    }

    /// `bind` for an assignment, whose target is a reference rather than a
    /// declaration, or a property, where the module goes on whole.
    pub(super) fn assign(&mut self, target: &AssignmentTarget, held: Held) {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(it) => {
                self.followed.insert(it.span.start);
                let symbol = self.symbol_of(it);
                self.hold(symbol, held);
            }
            AssignmentTarget::ObjectAssignmentTarget(it) => {
                for property in &it.properties {
                    match property {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(it) => {
                            self.add(held, &it.binding.name, it.span.start);
                            if let Some(taken) = self.destructured(held, &it.binding.name) {
                                let symbol = self.symbol_of(&it.binding);
                                self.hold(symbol, taken);
                            }
                        }
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(it) => {
                            let Some(name) = it.name.static_name() else {
                                self.add(held, WHOLE, it.span.start);
                                continue;
                            };
                            self.add(held, &name, it.span.start);
                            if let (Some(target), Some(taken)) = (target_of(&it.binding), self.destructured(held, &name)) {
                                self.assign(target, taken);
                            }
                        }
                    }
                }
                if let Some(rest) = &it.rest {
                    self.assign(&rest.target, held);
                }
            }
            AssignmentTarget::ArrayAssignmentTarget(it) => self.add(held, WHOLE, it.span.start),
            // A property, `o.rest`, stores the module where the walk does not follow it.
            other => self.add(held, WHOLE, oxc_span::GetSpan::span(other).start),
        }
    }

    /// `bind_all` for an assignment.
    pub(super) fn assign_all(&mut self, target: &AssignmentTarget, held: &[Option<Via>]) {
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
                        self.assign(target, Held::whole(request));
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
