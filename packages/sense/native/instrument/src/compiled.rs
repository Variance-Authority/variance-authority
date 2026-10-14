//! Compiled consumes style declarations as syntax, not as callbacks it calls.
//!
//! Its compiler replaces the callbacks with generated render code. A probe in
//! their expression body makes that syntax unrecognizable; those declarations
//! belong to the enclosing region, just like source sent to another realm.
//! Imported bindings identify the DSL, so runtime libraries and shadowed names
//! keep their ordinary regions. No compiler configuration is guessed here.

use std::collections::{HashMap, HashSet};
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_syntax::{scope::ScopeFlags, symbol::SymbolId};

pub fn has_styles(program: &Program) -> bool {
    program.body.iter().any(|statement| matches!(statement,
        Statement::ImportDeclaration(import) if import.source.value == "@compiled/react"))
}

pub fn callbacks<'a>(program: &'a Program<'a>, semantic: &Semantic<'a>) -> HashSet<(u32, u32)> {
    let mut styles = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        if import.source.value != "@compiled/react" || import.import_kind.is_type() { continue; }
        for specifier in import.specifiers.iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else { continue };
            let name = specifier.imported.name();
            if !specifier.import_kind.is_type() && matches!(name.as_str(), "styled" | "css" | "cssMap") {
                if let Some(symbol) = specifier.local.symbol_id.get() {
                    styles.insert(symbol, name.to_string());
                }
            }
        }
    }
    let mut sites = Sites { semantic, styles, found: HashSet::new() };
    sites.visit_program(program);
    sites.found
}

struct Sites<'s, 'a> {
    semantic: &'s Semantic<'a>,
    styles: HashMap<SymbolId, String>,
    found: HashSet<(u32, u32)>,
}

impl Sites<'_, '_> {
    fn style(&self, expression: &Expression) -> Option<&str> {
        match expression {
            Expression::Identifier(id) => id.reference_id.get()
                .and_then(|reference| self.semantic.scoping().get_reference(reference).symbol_id())
                .and_then(|symbol| self.styles.get(&symbol).map(String::as_str)),
            Expression::StaticMemberExpression(member) => (self.style(&member.object) == Some("styled")).then_some("declaration"),
            Expression::ComputedMemberExpression(member) => (self.style(&member.object) == Some("styled")).then_some("declaration"),
            Expression::CallExpression(call) => (self.style(&call.callee) == Some("styled")).then_some("declaration"),
            Expression::ParenthesizedExpression(inner) => self.style(&inner.expression),
            _ => None,
        }
    }
}

impl<'a> Visit<'a> for Sites<'_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.style(&call.callee).is_some_and(|name| name != "styled") {
            for argument in &call.arguments {
                let mut functions = Functions { found: &mut self.found, semantic: self.semantic };
                functions.visit_argument(argument);
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.style(&tagged.tag).is_some() {
            Functions { found: &mut self.found, semantic: self.semantic }.visit_template_literal(&tagged.quasi);
        }
        walk::walk_tagged_template_expression(self, tagged);
    }
}

struct Functions<'s, 'a> {
    found: &'s mut HashSet<(u32, u32)>,
    semantic: &'s Semantic<'a>,
}
impl<'a> Visit<'a> for Functions<'_, 'a> {
    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        self.found.extend(crate::crossing::bound(self.semantic, id));
    }
    fn visit_function(&mut self, function: &Function<'a>, _: ScopeFlags) {
        self.found.insert((function.span.start, function.span.end));
    }
    fn visit_arrow_function_expression(&mut self, function: &ArrowFunctionExpression<'a>) {
        self.found.insert((function.span.start, function.span.end));
    }
}
