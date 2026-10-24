//! The names a function's own body declares: a `function` statement, and a
//! variable whose value is a function, written anywhere inside another function.
//!
//! Each is a name its holder alone can call, and a caller who typed it exactly
//! is not wrong about the name: ctags records it with its scope, and so does
//! this. A nested one keeps its own name, `shown`, and carries the function
//! that holds it: that function's name — its own, or the one a variable, a
//! method or a property binds it to — and the offset it starts at, which is all
//! a callback nobody named has. No other value is recorded: a body's other
//! locals are its working state, and what it calls is what a caller asks for.

// compass: variance-authority.reach.source-index

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use crate::top_level::declarator_end;

/// One function a function's body declares.
pub(crate) struct Nested {
    /// The name, as its declaration writes it: `shown`.
    pub(crate) name: String,
    /// `function`, or the variable keyword.
    pub(crate) kind: &'static str,
    /// The statement that declares it, where its line and its doc are read.
    pub(crate) statement: Span,
    /// The declaration up to its body.
    pub(crate) signature: Span,
    /// The name of the function that holds it, when that function has one.
    pub(crate) holder: Option<String>,
    /// Where the function that holds it starts.
    pub(crate) holder_at: u32,
}

/// Every function a function's body in `program` declares, in source order.
pub(crate) fn nested(program: &Program<'_>) -> Vec<Nested> {
    let mut walker = Walker::default();
    walker.visit_program(program);
    walker.found
}

#[derive(Default)]
struct Walker {
    found: Vec<Nested>,
    /// The functions around the walk, innermost last: each one's name, when it has one, and its start.
    holders: Vec<(Option<String>, u32)>,
    /// The name the next function takes from what binds it: a variable, a method, a property.
    pending: Option<String>,
}

impl Walker {
    /// Records one declaration under the innermost function, when the walk is inside one.
    fn found(&mut self, name: &str, kind: &'static str, statement: Span, signature: Span) {
        let Some((holder, at)) = self.holders.last() else { return };
        self.found.push(Nested { name: name.to_owned(), kind, statement, signature, holder: holder.clone(), holder_at: *at });
    }

    /// Walks a function's body as the holder of what it declares.
    fn holding(&mut self, name: Option<String>, start: u32, walk: impl FnOnce(&mut Self)) {
        self.holders.push((name, start));
        walk(self);
        self.holders.pop();
    }
}

fn is_function(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
}

impl<'a> Visit<'a> for Walker {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        let pending = self.pending.take();
        let own = it.id.as_ref().map(|id| id.name.to_string());
        if it.r#type == FunctionType::FunctionDeclaration && it.body.is_some() {
            if let Some(own) = &own {
                let end = it.body.as_ref().map_or(it.span.end, |body| body.span.start);
                self.found(own, "function", it.span, Span::new(it.span.start, end));
            }
        }
        // An overload or a `declare function` has no body to declare anything in.
        if it.body.is_none() {
            return walk::walk_function(self, it, flags);
        }
        let name = if it.r#type == FunctionType::FunctionDeclaration { own } else { pending.or(own) };
        self.holding(name, it.span.start, |walker| walk::walk_function(walker, it, flags));
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let name = self.pending.take();
        self.holding(name, it.span.start, |walker| walk::walk_arrow_function_expression(walker, it));
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        // A class declares nothing in a body of its own: its methods hold what they declare.
        self.pending = None;
        walk::walk_class(self, it);
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        self.pending = it.key.static_name().map(|name| name.into_owned());
        walk::walk_method_definition(self, it);
        self.pending = None;
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.pending = it.value.as_ref().filter(|value| is_function(value)).and_then(|_| it.key.static_name().map(|name| name.into_owned()));
        walk::walk_property_definition(self, it);
        self.pending = None;
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        self.visit_property_key(&it.key);
        self.pending = is_function(&it.value).then(|| it.key.static_name().map(|name| name.into_owned())).flatten();
        self.visit_expression(&it.value);
        self.pending = None;
    }

    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        let kind = match it.kind {
            VariableDeclarationKind::Var => "var",
            VariableDeclarationKind::Let => "let",
            VariableDeclarationKind::Const => "const",
            VariableDeclarationKind::Using => "using",
            VariableDeclarationKind::AwaitUsing => "await using",
        };
        for declarator in &it.declarations {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                self.visit_variable_declarator(declarator);
                continue;
            };
            let function = declarator.init.as_ref().is_some_and(is_function);
            if function {
                // One statement, one doc: the first declarator is documented above it.
                self.found(&id.name, kind, it.span, Span::new(it.span.start, declarator_end(declarator)));
            }
            if let Some(init) = &declarator.init {
                self.pending = function.then(|| id.name.to_string());
                self.visit_expression(init);
                self.pending = None;
            }
        }
    }

    fn visit_expression(&mut self, it: &Expression<'a>) {
        // A name binds the function written as the value, not one inside a call around it.
        if !is_function(it) && !matches!(it, Expression::ClassExpression(_)) {
            self.pending = None
        }
        walk::walk_expression(self, it);
    }

    // A namespace's or an ambient module's body is a top level, which `top_level` reads.
    fn visit_ts_namespace_declaration(&mut self, _: &TSNamespaceDeclaration<'a>) {}
    fn visit_ts_external_module_declaration(&mut self, _: &TSExternalModuleDeclaration<'a>) {}
    fn visit_ts_global_declaration(&mut self, _: &TSGlobalDeclaration<'a>) {}
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::nested;

    /// Each nested name, its kind, and its holder: the holder's name, and the line it starts on.
    fn names(source: &str) -> Vec<(String, &'static str, Option<String>, usize)> {
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, source, SourceType::ts()).parse().program;
        let line = |offset: u32| source[..offset as usize].matches('\n').count() + 1;
        nested(&program).into_iter().map(|one| (one.name, one.kind, one.holder, line(one.holder_at))).collect()
    }

    #[test]
    fn a_function_body_declares_its_closures_each_with_the_function_that_holds_it() {
        let source = "function tapOf() {\n  const shown = (value: unknown) => String(value);\n  function kindOf() { const inner = function () {}; return inner; }\n  const count = 1;\n  return shown(kindOf());\n}\nconst top = () => 1;\n";
        assert_eq!(
            names(source),
            vec![
                ("shown".to_owned(), "const", Some("tapOf".to_owned()), 1),
                ("kindOf".to_owned(), "function", Some("tapOf".to_owned()), 1),
                ("inner".to_owned(), "const", Some("kindOf".to_owned()), 3),
            ]
        );
    }

    #[test]
    fn a_method_a_variable_and_an_unnamed_callback_hold_what_they_declare() {
        let source = "class Tap {\n  listen() { function heard() {} }\n  near = () => { const far = () => 1; };\n}\nexport const run = () => { let step = () => 2; };\nit('x', () => {\n  function helper() {}\n});\n";
        assert_eq!(
            names(source),
            vec![
                ("heard".to_owned(), "function", Some("listen".to_owned()), 2),
                ("far".to_owned(), "const", Some("near".to_owned()), 3),
                ("step".to_owned(), "let", Some("run".to_owned()), 5),
                ("helper".to_owned(), "function", None, 6),
            ]
        );
    }

    #[test]
    fn the_top_level_and_a_namespace_declare_nothing_nested() {
        assert!(names("function a() {}\nconst b = () => 1;\nnamespace N { export function c() {} }\n").is_empty());
    }
}
