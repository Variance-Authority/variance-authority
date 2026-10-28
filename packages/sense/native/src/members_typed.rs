//! Where a type says a value is a module: `typeof import('m')` written on a
//! cast, a variable or a parameter, directly or through a top-level alias.
//! `M['name']` off such a type reads `name`.
//!
//! An alias is read before the walk, so a use above the alias's declaration
//! holds as well as one below it.

use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_syntax::symbol::SymbolId;

use super::{Held, Via, Walker};

impl Walker<'_, '_> {
    /// The module a type names whole: a bare `typeof import('m')`, or a
    /// reference to an alias of one.
    pub(super) fn typed(&self, written: &TSType) -> Option<Held> {
        let at = match written {
            TSType::TSParenthesizedType(it) => return self.typed(&it.type_annotation),
            TSType::TSTypeReference(it) if it.type_arguments.is_none() => {
                let TSTypeName::IdentifierReference(name) = &it.type_name else { return None };
                *self.aliases.get(&self.symbol_of(name)?)?
            }
            other => import_type_of(other)?,
        };
        Some(Held::whole(Via::TypedAt(at)))
    }

    /// What a cast says its value is: `x as typeof import('m')`, `satisfies`,
    /// or `<…>x`, written in place or on a variable's value. What a call
    /// returns is TypeScript's answer: the reader does not establish what a
    /// call given the type as an argument returns.
    pub(super) fn cast(&self, expression: &Expression) -> Option<Held> {
        let (written, inner) = match expression {
            Expression::ParenthesizedExpression(it) => return self.cast(&it.expression),
            Expression::TSAsExpression(it) => (&it.type_annotation, &it.expression),
            Expression::TSSatisfiesExpression(it) => (&it.type_annotation, &it.expression),
            Expression::TSTypeAssertion(it) => (&it.type_annotation, &it.expression),
            _ => return None,
        };
        self.typed(written).or_else(|| self.cast(inner))
    }

    /// The name `M['name']` reads off a module type `M`, and where it is spelled.
    pub(super) fn indexed<'t>(&self, it: &'t TSIndexedAccessType) -> Option<(Held, &'t str, u32)> {
        let TSType::TSLiteralType(literal) = &it.index_type else { return None };
        let TSLiteral::StringLiteral(name) = &literal.literal else { return None };
        Some((self.typed(&it.object_type)?, name.value.as_str(), name.span.start))
    }
}

/// Where the `import()` type of a bare `typeof import('m')` starts.
fn import_type_of(written: &TSType) -> Option<u32> {
    let TSType::TSTypeQuery(query) = written else { return None };
    match &query.expr_name {
        TSTypeQueryExprName::TSImportType(it) if it.qualifier.is_none() => Some(it.span.start),
        _ => None,
    }
}

/// Each top-level alias of a bare `typeof import('m')`, bare or exported, to
/// where its `import()` type starts.
pub(super) fn aliases(program: &Program) -> HashMap<SymbolId, u32> {
    program
        .body
        .iter()
        .filter_map(alias_in)
        .filter(|alias| alias.type_parameters.is_none())
        .filter_map(|alias| Some((alias.id.symbol_id.get()?, import_type_of(&alias.type_annotation)?)))
        .collect()
}

fn alias_in<'p, 'a>(statement: &'p Statement<'a>) -> Option<&'p TSTypeAliasDeclaration<'a>> {
    match statement {
        Statement::TSTypeAliasDeclaration(it) => Some(it),
        Statement::ExportDeclaration(it) => match &it.declaration {
            Declaration::TSTypeAliasDeclaration(it) => Some(it),
            _ => None,
        },
        _ => None,
    }
}
