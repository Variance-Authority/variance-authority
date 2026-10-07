//! The component names a module declares, read off its tree.
//!
//! A name is declared by a statement of the module itself — a function, a class,
//! or a `const` or `let` binding, exported or not — and starts with a capital, the
//! way a React component's name does. Text is never read: a comment, a string or
//! a template that spells a declaration declares nothing, and a name bound inside
//! a function body is that function's, not the module's.

use oxc_ast::ast::{
    Class, Declaration, ExportDefaultDeclarationKind, Function, Program, Statement,
    VariableDeclaration, VariableDeclarationKind,
};

/// Files whose names are not components: tests, stories and declaration files.
const NOT_DECLARING: [&str; 4] = [".test.", ".spec.", ".stories.", ".d.ts"];

/// The component names `program` declares, sorted, each once.
pub fn declarations(file: &str, program: &Program<'_>) -> Vec<String> {
    if NOT_DECLARING.iter().any(|skip| file.contains(skip)) {
        return Vec::new();
    }
    let mut found = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::FunctionDeclaration(function) => function_name(function, &mut found),
            Statement::ClassDeclaration(class) => class_name(class, &mut found),
            Statement::VariableDeclaration(variables) => binding_names(variables, &mut found),
            Statement::ExportDeclaration(exported) => match &exported.declaration {
                Declaration::FunctionDeclaration(function) => function_name(function, &mut found),
                Declaration::ClassDeclaration(class) => class_name(class, &mut found),
                Declaration::VariableDeclaration(variables) => binding_names(variables, &mut found),
                _ => {}
            },
            Statement::ExportDefaultDeclaration(exported) => match &exported.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => function_name(function, &mut found),
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class_name(class, &mut found),
                _ => {}
            },
            _ => {}
        }
    }
    found.sort();
    found.dedup();
    found
}

fn function_name(function: &Function<'_>, found: &mut Vec<String>) {
    if let Some(id) = function.id.as_ref().filter(|_| !function.declare) {
        push(id.name.as_str(), found);
    }
}

fn class_name(class: &Class<'_>, found: &mut Vec<String>) {
    if let Some(id) = class.id.as_ref().filter(|_| !class.declare) {
        push(id.name.as_str(), found);
    }
}

fn binding_names(variables: &VariableDeclaration<'_>, found: &mut Vec<String>) {
    let bound = matches!(variables.kind, VariableDeclarationKind::Const | VariableDeclarationKind::Let);
    if !bound || variables.declare {
        return;
    }
    for declarator in &variables.declarations {
        if let Some(id) = declarator.id.get_binding_identifier() {
            push(id.name.as_str(), found);
        }
    }
}

/// A name a component could have: a capital, then letters, digits or `_`.
fn push(name: &str, found: &mut Vec<String>) {
    let mut characters = name.chars();
    let capital = characters.next().is_some_and(|first| first.is_ascii_uppercase());
    if capital && characters.all(|rest| rest.is_ascii_alphanumeric() || rest == '_') {
        found.push(name.to_owned());
    }
}

#[cfg(test)]
#[path = "declarations_tests.rs"]
mod tests;
