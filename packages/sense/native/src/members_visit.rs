//! What the members walk does at each node it meets: where a module is bound,
//! written, read off, handed out or passed on.

// compass: variance-authority.reach.source-index

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};

use super::{Held, Via, Walker, WHOLE};

impl<'a> Visit<'a> for Walker<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let annotated = it.type_annotation.as_ref().and_then(|it| self.typed(&it.type_annotation));
        if let Some(init) = &it.init {
            if let Some(held) = self.held_all(init) {
                self.bind_all(&it.id, &held);
            } else if let Some(held) = Some(self.held(init)).filter(|held| !held.is_empty()).or(annotated.map(|held| vec![held])) {
                self.bind(&it.id, &held);
            } else if !matches!(it.id, BindingPattern::BindingIdentifier(_)) {
                // A pattern destructures the promise, which reads it and holds nothing.
                self.promise_read(init);
            }
        } else if let Some(held) = annotated {
            self.bind(&it.id, &[held]);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        self.assignment(it);
    }

    // A `break`, a `continue` or a throw may leave these from anywhere in them.
    fn visit_statement(&mut self, it: &Statement<'a>) {
        match it {
            Statement::WhileStatement(_)
            | Statement::DoWhileStatement(_)
            | Statement::ForStatement(_)
            | Statement::ForInStatement(_)
            | Statement::ForOfStatement(_)
            | Statement::SwitchStatement(_)
            | Statement::LabeledStatement(_)
            | Statement::TryStatement(_) => self.leaving(|walker| walk::walk_statement(walker, it)),
            _ => walk::walk_statement(self, it),
        }
    }

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        self.visit_expression(&it.test);
        self.either(|walker| walker.visit_statement(&it.consequent), |walker| it.alternate.iter().for_each(|it| walker.visit_statement(it)));
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        self.visit_expression(&it.test);
        self.either(|walker| walker.visit_expression(&it.consequent), |walker| walker.visit_expression(&it.alternate));
    }

    // An exported holder is the module handed to every importer of this file,
    // where the walk does not follow it: it goes on whole at its binding.
    fn visit_export_declaration(&mut self, it: &ExportDeclaration<'a>) {
        walk::walk_export_declaration(self, it);
        let bindings = match &it.declaration {
            Declaration::VariableDeclaration(declaration) => declaration.declarations.iter().flat_map(|it| it.id.get_binding_identifiers()).collect(),
            Declaration::TSImportEqualsDeclaration(declaration) => vec![&declaration.id],
            _ => Vec::new(),
        };
        for binding in bindings {
            for held in binding.symbol_id.get().map_or_else(Vec::new, |symbol| self.holding(symbol, None)) {
                self.add(held, WHOLE, binding.span.start);
            }
        }
    }

    fn visit_expression_statement(&mut self, it: &ExpressionStatement<'a>) {
        self.discarded(&it.expression);
        self.surely(&it.expression);
        walk::walk_expression_statement(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        let held = self.held(&it.object);
        if held.is_empty() && !matches!(it.property.name.as_str(), "then" | "catch" | "finally") {
            self.promise_read(&it.object);
        }
        for held in held {
            self.add(held, &it.property.name, it.property.span.start);
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        // A key the walk cannot spell reads the module whole: the object is not followed.
        if let Expression::StringLiteral(name) = &it.expression {
            let held = self.held(&it.object);
            if held.is_empty() {
                self.promise_read(&it.object);
            }
            for held in held {
                self.add(held, name.value.as_str().unwrap_or(WHOLE), name.span.start);
            }
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_jsx_member_expression(&mut self, it: &JSXMemberExpression<'a>) {
        for held in self.jsx_held(&it.object) {
            self.add(held, &it.property.name, it.property.span.start);
        }
        walk::walk_jsx_member_expression(self, it);
    }

    // `ns.T` in a type reads `T` off the holder, and `ns.a.b` reads `a` off
    // it and `b` off the value `ns.a` is, as the same names do in a value.
    fn visit_ts_qualified_name(&mut self, it: &TSQualifiedName<'a>) {
        for held in self.qualified_held(&it.left) {
            self.add(held, &it.right.name, it.right.span.start);
        }
        walk::walk_ts_qualified_name(self, it);
    }

    // `M['a']` off a module type reads `a`.
    fn visit_ts_indexed_access_type(&mut self, it: &TSIndexedAccessType<'a>) {
        if let Some((held, name, at)) = self.indexed(it) {
            self.add(held, name, at);
        }
        walk::walk_ts_indexed_access_type(self, it);
    }

    // Read as a value where the walk does not follow it, the module goes on
    // whole. A write replaces the value, and a type query reads its type.
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let Some(reference) = it.reference_id.get() else { return };
        let reference = self.scoping.get_reference(reference);
        let flags = reference.flags();
        if !flags.is_read() || flags.is_type() || flags.is_value_as_type() || self.followed.contains(&it.span.start) {
            return;
        }
        let Some(symbol) = reference.symbol_id() else { return };
        for held in self.holding(symbol, Some(reference.scope_id())) {
            self.add(held, WHOLE, it.span.start);
        }
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Some(index) = self.loads.import(it) {
            if !self.followed.contains(&it.span.start) {
                self.add(Held::whole(Via::Indexed(self.stated + index)), WHOLE, it.span.start);
            }
        }
        walk::walk_import_expression(self, it);
    }

    fn visit_ts_import_type(&mut self, it: &TSImportType<'a>) {
        if let Some(index) = self.loads.import_type(it) {
            self.typed_at.insert(it.span.start, index);
            let mut qualifier = it.qualifier.as_ref();
            while let Some(TSImportTypeQualifier::QualifiedName(name)) = qualifier {
                qualifier = Some(&name.left);
            }
            if let Some(TSImportTypeQualifier::Identifier(name)) = qualifier {
                self.add(Held::whole(Via::Typed(index)), &name.name, it.span.start);
            }
        }
        walk::walk_ts_import_type(self, it);
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let Some(held) = it.type_annotation.as_ref().and_then(|it| self.typed(&it.type_annotation)) {
            self.typed_parameter(it, held);
        }
        walk::walk_formal_parameter(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        if let Some(index) = self.loads.import_equals(it) {
            self.hold(it.id.symbol_id.get(), &[Held::whole(Via::Required(index))]);
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }

    // `import('m').then((m) => …)`: the callback's first parameter holds the
    // module, and `Promise.all([import('m')]).then(([m]) => …)` pairs as `await`
    // does. A callback that is not written there takes the module whole.
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // A `require` the walk does not follow goes on whole, as an `import()`'s does.
        if let Some(index) = self.loads.call(it, self.mock_factory.as_deref()).filter(|_| !self.followed.contains(&it.span.start)) {
            self.add(Held::whole(Via::Required(index)), WHOLE, it.span.start);
        }
        if let Some(target) = crate::mocks::factory_target(it) {
            self.visit_expression(&it.callee);
            for (index, argument) in it.arguments.iter().enumerate() {
                if index == 1 {
                    let previous = self.mock_factory.replace(target.clone());
                    self.visit_argument(argument);
                    self.mock_factory = previous;
                } else {
                    self.visit_argument(argument);
                }
            }
            return;
        }
        if let Expression::StaticMemberExpression(callee) = it.callee.get_inner_expression() {
            if callee.property.name == "then" {
                let first = match it.arguments.first() {
                    Some(Argument::ArrowFunctionExpression(f)) => Some(f.params.items.first()),
                    Some(Argument::FunctionExpression(f)) => Some(f.params.items.first()),
                    _ => None,
                };
                if let Some(parameter) = first {
                    if let Some(held) = self.promised_all(&callee.object) {
                        if let Some(parameter) = parameter {
                            self.bind_all(&parameter.pattern, &held);
                        }
                    } else if let Some(request) = self.promised(&callee.object) {
                        if let Some(parameter) = parameter {
                            self.bind(&parameter.pattern, &[Held::whole(request)]);
                        }
                    }
                }
            }
        }
        self.pass(it);
        walk::walk_call_expression(self, it);
    }
}
