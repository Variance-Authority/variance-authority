//! The members a Python, Swift, Java or Kotlin file declares on its types.
//!
//! A member is the file's own declaration as much as a top-level item is, and
//! no import names it: a method or a field of a Java class is reached through a
//! value. The TypeScript reader records the members of an interface, a type
//! literal and a class (`help_members.rs`); this records the same fact for
//! these grammars, in the same shape, so `ask symbol` and `ask uses` answer a
//! member whichever language declares it. None of them records the lines that
//! use a member.
//!
//! A container is a type that holds named members: a Java or Kotlin class,
//! interface, enum, record or object; a Swift struct, class, enum, actor,
//! protocol or extension, which is on the type it extends, named without its
//! path; a Python class. A container inside a function, a module or another
//! container is read the same way. A constructor is left out: it is named for
//! its class, which the class already answers. A Python attribute assigned in
//! a method is a statement, not a declaration, and is left out too.
//!
//! Each member is recorded on the line its name is written on, so a decorator
//! or an attribute above it does not move it.

// compass: variance-authority.reach.source-index

use tree_sitter::{Node, Tree};

use super::{children_for_field, line_of, named_children, text_of};
use crate::grammar::Grammar;
use crate::help_members::MemberDeclaration;

/// What a member on a Kotlin companion object with no name is said to be on.
const A_COMPANION: &str = "a companion object";

/// Every member `tree` declares on a container, containers in source order and
/// each one's members in theirs.
pub fn members(grammar: Grammar, tree: &Tree, source: &str) -> Vec<MemberDeclaration> {
    let mut held = Vec::new();
    walk(grammar, tree.root_node(), source, &mut held);
    held
}

fn walk(grammar: Grammar, node: Node, source: &str, held: &mut Vec<MemberDeclaration>) {
    if let Some((on, bodies)) = container(grammar, node, source) {
        for body in bodies {
            for child in named_children(body) {
                for name in member_names(grammar, child) {
                    held.push(MemberDeclaration { name: text_of(name, source).to_owned(), line: line_of(name), on: on.clone() });
                }
            }
        }
    }
    for child in named_children(node) {
        walk(grammar, child, source, held);
    }
}

/// The name a container's members are on, and the nodes that hold them.
fn container<'tree>(grammar: Grammar, node: Node<'tree>, source: &str) -> Option<(String, Vec<Node<'tree>>)> {
    let named = |field: &str| node.child_by_field_name(field).map(|name| text_of(name, source).to_owned());
    let body = node.child_by_field_name("body");
    let (on, mut bodies) = match (grammar, node.kind()) {
        (Grammar::Java, "class_declaration" | "interface_declaration" | "enum_declaration" | "record_declaration" | "annotation_type_declaration") => {
            // A record's components are its accessors; an enum's members past
            // its constants sit one level down.
            let mut held: Vec<Node> = node.child_by_field_name("parameters").into_iter().collect();
            if let Some(body) = body {
                held.push(body);
                held.extend(named_children(body).into_iter().filter(|child| child.kind() == "enum_body_declarations"));
            }
            (named("name")?, held)
        }
        (Grammar::Kotlin, "class_declaration" | "object_declaration" | "companion_object") => {
            let on = named("name").unwrap_or_else(|| A_COMPANION.to_owned());
            // A primary constructor's `val` and `var` parameters come first, as they are written.
            let held = named_children(node)
                .into_iter()
                .flat_map(|child| match child.kind() {
                    "class_body" | "enum_class_body" => vec![child],
                    "primary_constructor" => named_children(child),
                    _ => Vec::new(),
                })
                .collect();
            (on, held)
        }
        (Grammar::Swift, "class_declaration" | "protocol_declaration") => (type_named(node.child_by_field_name("name")?, source), body.into_iter().collect()),
        (Grammar::Python, "class_definition") => (named("name")?, body.into_iter().collect()),
        _ => return None,
    };
    bodies.retain(|body| !body.is_missing());
    Some((on, bodies))
}

/// A type as its members are said to be on: its own name, without the path
/// that reaches it.
fn type_named(node: Node, source: &str) -> String {
    match node.kind() {
        // Swift writes an extension's type as a `user_type`, its last part the type's own name.
        "user_type" => named_children(node).into_iter().last().map_or_else(|| text_of(node, source).to_owned(), |last| text_of(last, source).to_owned()),
        _ => text_of(node, source).to_owned(),
    }
}

/// The name nodes one child of a container's body declares as members.
fn member_names(grammar: Grammar, node: Node) -> Vec<Node> {
    let field = |name: &str| node.child_by_field_name(name).into_iter().collect::<Vec<_>>();
    match (grammar, node.kind()) {
        (Grammar::Java, "method_declaration" | "enum_constant" | "formal_parameter" | "annotation_type_element_declaration") => field("name"),
        (Grammar::Java, "field_declaration" | "constant_declaration") => {
            children_for_field(node, "declarator").into_iter().filter_map(|declarator| declarator.child_by_field_name("name")).collect()
        }
        (Grammar::Kotlin, "function_declaration") => field("name"),
        (Grammar::Kotlin, "property_declaration") => named_children(node)
            .into_iter()
            .filter(|child| child.kind() == "variable_declaration")
            .filter_map(|variable| named_children(variable).into_iter().find(|part| part.kind() == "identifier"))
            .collect(),
        (Grammar::Kotlin, "enum_entry") => named_children(node).into_iter().filter(|child| child.kind() == "identifier").take(1).collect(),
        // A constructor parameter is a property only when `val` or `var` declares it.
        (Grammar::Kotlin, "class_parameter") => {
            let mut cursor = node.walk();
            let property = node.children(&mut cursor).any(|child| matches!(child.kind(), "val" | "var"));
            if property { named_children(node).into_iter().filter(|child| child.kind() == "identifier").take(1).collect() } else { Vec::new() }
        }
        (Grammar::Swift, "function_declaration" | "protocol_function_declaration" | "typealias_declaration") => field("name"),
        (Grammar::Swift, "property_declaration" | "protocol_property_declaration") => {
            children_for_field(node, "name").into_iter().filter_map(|pattern| pattern.child_by_field_name("bound_identifier")).collect()
        }
        (Grammar::Swift, "enum_entry") => children_for_field(node, "name"),
        (Grammar::Python, "function_definition") => field("name"),
        (Grammar::Python, "decorated_definition") => node
            .child_by_field_name("definition")
            .filter(|definition| definition.kind() == "function_definition")
            .and_then(|definition| definition.child_by_field_name("name"))
            .into_iter()
            .collect(),
        (Grammar::Python, "expression_statement") => named_children(node)
            .into_iter()
            .filter(|child| child.kind() == "assignment")
            .filter_map(|assignment| assignment.child_by_field_name("left"))
            .filter(|left| left.kind() == "identifier")
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
#[path = "members_tests.rs"]
mod tests;
