//! The component names a module declares, read off its tree.
//!
//! A name is declared by a statement of the module itself — a function, a class,
//! or a `const` or `let` binding, exported or not — and starts with a capital, the
//! way a React component's name does. Text is never read: a comment, a string or
//! a template that spells a declaration declares nothing, and a name bound inside
//! a function body is that function's, not the module's.

use oxc_ast::ast::Program;

use crate::top_level::top_level;

/// Files whose names are not components: tests, stories and declaration files.
const NOT_DECLARING: [&str; 4] = [".test.", ".spec.", ".stories.", ".d.ts"];

/// The component names `program` declares, sorted, each once.
pub fn declarations(file: &str, program: &Program<'_>) -> Vec<String> {
    if NOT_DECLARING.iter().any(|skip| file.contains(skip)) {
        return Vec::new();
    }
    let mut found = Vec::new();
    top_level(program, |bound| {
        let declaring = matches!(bound.kind, "function" | "class" | "const" | "let");
        if declaring && !bound.declare && !bound.default && !bound.destructured {
            push(bound.name, &mut found);
        }
    });
    found.sort();
    found.dedup();
    found
}

/// A name a component could have: one that starts with a capital. The parser
/// has already decided the rest is an identifier.
fn push(name: &str, found: &mut Vec<String>) {
    if name.chars().next().is_some_and(char::is_uppercase) {
        found.push(name.to_owned());
    }
}

#[cfg(test)]
#[path = "declarations_tests.rs"]
mod tests;
