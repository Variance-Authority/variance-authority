//! The object literal a module hands out whole: `export = { … }` or
//! `module.exports = { … }`, written as a statement of its own at the top level.
//!
//! CommonJS is read on a best-effort basis, and this is the one shape read: the
//! object is what every importer gets, so each static key it spells is a name
//! the module exports, bound to what its value names when the value is an
//! identifier. Naming a declaration there passes it on, as `export { name }`
//! does; any other value is an expression of the module.

use oxc_ast::ast::*;
use oxc_span::Span;

/// One key of the object, where it is written, and the identifier its value
/// names, when it names one.
pub(crate) struct Key<'p, 'a> {
    pub(crate) name: String,
    pub(crate) span: Span,
    pub(crate) local: Option<&'p IdentifierReference<'a>>,
}

/// What `statement` hands out as the module, if it is `export = value` or
/// `module.exports = value`.
pub(crate) fn handed_out<'p, 'a>(statement: &'p Statement<'a>) -> Option<&'p Expression<'a>> {
    match statement {
        Statement::TSExportAssignment(it) => Some(&it.expression),
        Statement::ExpressionStatement(it) => {
            let Expression::AssignmentExpression(assignment) = it.expression.get_inner_expression() else { return None };
            let AssignmentTarget::StaticMemberExpression(target) = &assignment.left else { return None };
            if assignment.operator != AssignmentOperator::Assign || !target.object.is_specific_id("module") || target.property.name != "exports" {
                return None;
            }
            Some(&assignment.right)
        }
        _ => None,
    }
}

/// The object `statement` hands out as the module, if it hands out an object literal.
pub(crate) fn assigned<'p, 'a>(statement: &'p Statement<'a>) -> Option<&'p ObjectExpression<'a>> {
    match handed_out(statement)?.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        _ => None,
    }
}

/// The identifier a property's value names, when it names one.
pub(crate) fn named<'p, 'a>(property: &'p ObjectProperty<'a>) -> Option<&'p IdentifierReference<'a>> {
    match property.value.get_inner_expression() {
        Expression::Identifier(it) => Some(it),
        _ => None,
    }
}

/// Whether a reader can spell every key of `object`: a spread or a computed
/// key hands out names no reader knows, so the object's exports are not known.
pub(crate) fn spelled(object: &ObjectExpression) -> bool {
    object.properties.iter().all(|property| matches!(property, ObjectPropertyKind::ObjectProperty(it) if it.key.static_name().is_some()))
}

/// The keys of `object` a reader can spell.
pub(crate) fn keys<'p, 'a>(object: &'p ObjectExpression<'a>) -> impl Iterator<Item = Key<'p, 'a>> {
    object.properties.iter().filter_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else { return None };
        let name = property.key.static_name()?.into_owned();
        Some(Key { name, span: property.span, local: named(property) })
    })
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::{assigned, keys};

    fn handed_out(source: &str) -> Vec<(String, Option<String>)> {
        let allocator = Allocator::default();
        let program = Parser::new(&allocator, source, SourceType::ts()).parse().program;
        program.body.iter().filter_map(assigned).flat_map(keys).map(|key| (key.name, key.local.map(|it| it.name.to_string()))).collect()
    }

    #[test]
    fn an_export_assignment_hands_out_each_key_bound_to_what_it_names() {
        let found = handed_out("function a() {}\nexport = { a, b: a, c: () => a(), [`d`]: 1, ...rest, [key]: 2 };\n");
        assert_eq!(found, [("a".into(), Some("a".into())), ("b".into(), Some("a".into())), ("c".into(), None), ("d".into(), None)]);
    }

    #[test]
    fn module_exports_hands_out_its_object_and_nothing_else_does() {
        assert_eq!(handed_out("module.exports = { a };\n"), [("a".to_owned(), Some("a".to_owned()))]);
        assert!(handed_out("exports.a = { b };\nmodule.exports.a = { c };\nother.exports = { d };\nexport default { e };\n").is_empty());
        assert!(handed_out("function f() { module.exports = { a }; }\n").is_empty());
    }
}
