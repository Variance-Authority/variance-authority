//! How the walker reads each node: which ones are guards, which name a
//! function, and which are calls.

use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::scope::ScopeFlags;

use super::*;

impl<'a> Visit<'a> for Walker {
    fn visit_statements(&mut self, statements: &oxc_allocator::Vec<'a, Statement<'a>>) {
        let (guard, exited) = (self.guard, self.exited);
        let mut run = guard;
        let mut any = false;
        for statement in statements {
            self.exited = false;
            self.guard = run;
            self.visit_statement(statement);
            if self.exited {
                any = true;
                if !matches!(statement, Statement::ReturnStatement(_) | Statement::ThrowStatement(_)) {
                    run += 1;
                }
            }
        }
        self.guard = guard;
        self.exited = exited || any;
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        walk::walk_return_statement(self, it);
        self.exited = true;
    }

    fn visit_throw_statement(&mut self, it: &ThrowStatement<'a>) {
        walk::walk_throw_statement(self, it);
        self.exited = true;
    }

    fn visit_class_body(&mut self, it: &ClassBody<'a>) {
        let exited = self.exited;
        walk::walk_class_body(self, it);
        self.exited = exited;
    }

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        self.visit_expression(&it.test);
        self.guarded(|walker| {
            walker.visit_statement(&it.consequent);
            if let Some(alternate) = &it.alternate {
                walker.visit_statement(alternate);
            }
        });
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        self.visit_expression(&it.test);
        self.guarded(|walker| {
            walker.visit_expression(&it.consequent);
            walker.visit_expression(&it.alternate);
        });
    }

    fn visit_logical_expression(&mut self, it: &LogicalExpression<'a>) {
        self.visit_expression(&it.left);
        self.guarded(|walker| walker.visit_expression(&it.right));
    }

    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        self.visit_expression(&it.discriminant);
        self.guarded(|walker| walker.visit_switch_cases(&it.cases));
    }

    fn visit_try_statement(&mut self, it: &TryStatement<'a>) {
        self.visit_block_statement(&it.block);
        if let Some(handler) = &it.handler {
            self.guarded(|walker| walker.visit_catch_clause(handler));
        }
        if let Some(finalizer) = &it.finalizer {
            self.visit_block_statement(finalizer);
        }
    }

    fn visit_assignment_pattern(&mut self, it: &AssignmentPattern<'a>) {
        self.visit_binding_pattern(&it.left);
        self.guarded(|walker| walker.visit_expression(&it.right));
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        self.visit_decorators(&it.decorators);
        self.visit_binding_pattern(&it.pattern);
        if let Some(annotation) = &it.type_annotation {
            self.visit_ts_type_annotation(annotation);
        }
        if let Some(initializer) = &it.initializer {
            self.guarded(|walker| walker.visit_expression(initializer));
        }
    }

    fn visit_assignment_target_with_default(&mut self, it: &AssignmentTargetWithDefault<'a>) {
        self.visit_assignment_target(&it.binding);
        self.guarded(|walker| walker.visit_expression(&it.init));
    }

    fn visit_assignment_target_property_identifier(&mut self, it: &AssignmentTargetPropertyIdentifier<'a>) {
        self.visit_identifier_reference(&it.binding);
        if let Some(init) = &it.init {
            self.guarded(|walker| walker.visit_expression(init));
        }
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if it.body.is_none() {
            // A signature: nothing runs, and nothing is recorded for it.
            self.pending = None;
            walk::walk_function(self, it, flags);
            return;
        }
        let params = self.params(it.this_param.is_some(), &it.params);
        let id = it.id.as_ref().map(|id| id.name.to_string());
        self.function(it.span, id, params, |walker| walk::walk_function(walker, it, flags));
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let params = self.params(false, &it.params);
        self.function(it.span, None, params, |walker| walk::walk_arrow_function_expression(walker, it));
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if self.stack.is_empty() {
            if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
                if !is_function(init) {
                    self.decls.insert(id.name.to_string(), Decl { start: it.span.start, end: it.span.end, made: made_by(init) });
                }
            }
        }
        self.visit_binding_pattern(&it.id);
        if let Some(annotation) = &it.type_annotation {
            self.visit_ts_type_annotation(annotation);
        }
        if let Some(init) = &it.init {
            let hint = match &it.id {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                _ => None,
            };
            self.hinted(init, hint);
        }
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        if self.stack.is_empty() && it.r#type == ClassType::ClassDeclaration {
            if let Some(id) = &it.id {
                self.decls.insert(id.name.to_string(), Decl { start: it.span.start, end: it.span.end, made: None });
            }
        }
        walk::walk_class(self, it);
    }

    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        let skipped = matches!(
            &it.declaration,
            ExportDefaultDeclarationKind::FunctionDeclaration(_)
                | ExportDefaultDeclarationKind::FunctionExpression(_)
                | ExportDefaultDeclarationKind::ArrowFunctionExpression(_)
                | ExportDefaultDeclarationKind::Identifier(_)
        );
        if !skipped {
            let span = it.declaration.span();
            let made = it.declaration.as_expression().and_then(made_by);
            self.decls.insert("default".to_owned(), Decl { start: span.start, end: span.end, made });
        }
        walk::walk_export_default_declaration(self, it);
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        self.visit_property_key(&it.key);
        self.hinted(&it.value, key_name(&it.key));
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        self.visit_decorators(&it.decorators);
        self.visit_property_key(&it.key);
        self.pending = Some(Pending { hint: key_name(&it.key), ..Pending::default() });
        self.visit_function(&it.value, ScopeFlags::Function);
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.visit_decorators(&it.decorators);
        self.visit_property_key(&it.key);
        if let Some(annotation) = &it.type_annotation {
            self.visit_ts_type_annotation(annotation);
        }
        if let Some(value) = &it.value {
            self.hinted(value, key_name(&it.key));
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let own = self.guard + u32::from(it.optional);
        let callee = callee_of(&it.callee);
        let via = via_of(&callee);
        self.call(it.span, callee, &it.arguments, own, false);
        self.visit_expression(&it.callee);
        if let Some(arguments) = &it.type_arguments {
            self.visit_ts_type_parameter_instantiation(arguments);
        }
        self.arguments(it.span, &it.arguments, via, own, true);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        let own = self.guard;
        let callee = callee_of(&it.callee);
        let via = via_of(&callee);
        self.call(it.span, callee, &it.arguments, own, true);
        self.visit_expression(&it.callee);
        if let Some(arguments) = &it.type_arguments {
            self.visit_ts_type_parameter_instantiation(arguments);
        }
        self.arguments(it.span, &it.arguments, via, own, false);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        let own = self.guard;
        self.call(it.span, callee_of(&it.tag), &[], own, false);
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'a>) {
        let name = match &it.name {
            JSXElementName::Identifier(it) => Some(it.name.as_str()),
            JSXElementName::IdentifierReference(it) => Some(it.name.as_str()),
            _ => None,
        };
        if let Some(name) = name.filter(|name| name.starts_with(|first: char| first.is_ascii_uppercase())) {
            let (from, line, guard) = (self.from(), self.line(it.span.start), self.guard);
            let callee = Callee { id: Some(name.to_owned()), ..Callee::default() };
            self.calls.push(Call { from, line, col: it.span.end as u64 * 4, callback: None, guard, is_new: false, by_ref: false, callee });
        }
        walk::walk_jsx_opening_element(self, it);
    }
}
