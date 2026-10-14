//! Functions whose source a caller-declared consumer reads as syntax.
//!
//! Imports and callee paths come from the integration; the instrumenter knows
//! no compiler or library. Runtime calls inside consumed values keep probes.

use std::collections::{HashMap, HashSet};
use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_syntax::{scope::ScopeFlags, symbol::SymbolId};

/// One step from an imported binding to the expression consuming source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsumerStep { Member, Call }

/// Which syntax the declared consumer reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Consumption {
    /// None consumes every argument; an empty list consumes none.
    Arguments(Option<Vec<u32>>),
    Template,
}

/// An imported binding and the source positions its consumer owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceConsumed {
    pub module: String,
    pub imported: String,
    pub path: Vec<ConsumerStep>,
    pub syntax: Consumption,
}

pub fn has_consumers(program: &Program, rules: &[SourceConsumed]) -> bool {
    program.body.iter().any(|statement| matches!(statement,
        Statement::ImportDeclaration(import) if rules.iter().any(|rule| import.source.value == rule.module)))
}

pub fn callbacks<'a>(program: &'a Program<'a>, semantic: &Semantic<'a>, rules: &[SourceConsumed]) -> HashSet<(u32, u32)> {
    let mut bindings: HashMap<SymbolId, Vec<&SourceConsumed>> = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        if import.import_kind.is_type() { continue; }
        for specifier in import.specifiers.iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else { continue };
            if specifier.import_kind.is_type() { continue; }
            if let Some(symbol) = specifier.local.symbol_id.get() {
                bindings.entry(symbol).or_default().extend(rules.iter().filter(|rule|
                    import.source.value == rule.module && specifier.imported.name() == rule.imported));
            }
        }
    }
    let mut sites = Sites { semantic, bindings, found: HashSet::new(), followed: HashSet::new() };
    sites.visit_program(program);
    sites.found
}

struct Sites<'s, 'a> {
    semantic: &'s Semantic<'a>,
    bindings: HashMap<SymbolId, Vec<&'s SourceConsumed>>,
    found: HashSet<(u32, u32)>,
    followed: HashSet<(u32, u32)>,
}

impl Sites<'_, '_> {
    fn origin(&self, expression: &Expression) -> Option<(SymbolId, Vec<ConsumerStep>)> {
        let (symbol, mut path) = match crate::crossing::bare(expression) {
            Expression::Identifier(id) => return id.reference_id.get()
                .and_then(|reference| self.semantic.scoping().get_reference(reference).symbol_id())
                .map(|symbol| (symbol, vec![])),
            Expression::StaticMemberExpression(member) => self.origin(&member.object)?,
            Expression::ComputedMemberExpression(member) => self.origin(&member.object)?,
            Expression::CallExpression(call) => {
                let (symbol, mut path) = self.origin(&call.callee)?;
                path.push(ConsumerStep::Call);
                return Some((symbol, path));
            }
            _ => return None,
        };
        path.push(ConsumerStep::Member);
        Some((symbol, path))
    }
}

impl<'a> Visit<'a> for Sites<'_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some((symbol, path)) = self.origin(&call.callee) {
            if let Some(rules) = self.bindings.get(&symbol) {
                for rule in rules.iter().filter(|rule| rule.path == path) {
                    let Consumption::Arguments(arguments) = &rule.syntax else { continue };
                    for (index, argument) in call.arguments.iter().enumerate() {
                        if arguments.as_ref().is_some_and(|args| !args.contains(&(index as u32))) { continue; }
                        Functions { found: &mut self.found, semantic: self.semantic, followed: &mut self.followed }.visit_argument(argument);
                    }
                }
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if let Some((symbol, path)) = self.origin(&tagged.tag) {
            if self.bindings.get(&symbol).is_some_and(|rules| rules.iter().any(|rule|
                rule.path == path && rule.syntax == Consumption::Template)) {
                Functions { found: &mut self.found, semantic: self.semantic, followed: &mut self.followed }.visit_template_literal(&tagged.quasi);
            }
        }
        walk::walk_tagged_template_expression(self, tagged);
    }
}

struct Functions<'s, 'a> {
    found: &'s mut HashSet<(u32, u32)>,
    semantic: &'s Semantic<'a>,
    followed: &'s mut HashSet<(u32, u32)>,
}
impl<'a> Visit<'a> for Functions<'_, 'a> {
    // Calls inside consumed values execute at runtime; Sites finds nested consumer calls
    // separately, by their declared binding, rather than by traversing their values.
    fn visit_call_expression(&mut self, _: &CallExpression<'a>) {}

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        match crate::crossing::bound_declaration(self.semantic, id) {
            Some(AstKind::VariableDeclarator(declarator))
                if matches!(declarator.id, BindingPattern::BindingIdentifier(_)) => {
                if self.followed.insert((declarator.span.start, declarator.span.end)) {
                    if let Some(value) = &declarator.init { self.visit_expression(value); }
                }
            }
            Some(AstKind::Function(function)) if function.body.is_some() => {
                self.found.insert((function.span.start, function.span.end));
            }
            _ => {}
        }
    }
    fn visit_function(&mut self, function: &Function<'a>, _: ScopeFlags) {
        self.found.insert((function.span.start, function.span.end));
    }
    fn visit_arrow_function_expression(&mut self, function: &ArrowFunctionExpression<'a>) {
        self.found.insert((function.span.start, function.span.end));
    }
}
