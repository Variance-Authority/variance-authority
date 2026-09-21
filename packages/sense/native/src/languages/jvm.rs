//! What a Java or Kotlin file asks for and what it publishes.
//!
//! One reader for both, because the two grammars answer the same two questions
//! with nodes that differ only in name ([`jvm.ts`](../../../src/jvm.ts) is the
//! oracle this is measured against). Resolution — a package name to the
//! directories a source root puts it in — stays in TypeScript.

use std::collections::HashSet;

use tree_sitter::{Node, Tree};

use super::shape::{Binding, Export, Kind, Read, Request};
use super::{line_of, named_children, text_of};

/// The suffix that makes a request name a package directory rather than a file.
const WHOLE_PACKAGE: &str = ".*";

struct Gathering {
    requests: Vec<Request>,
    exports: Vec<Export>,
    seen: HashSet<String>,
    broken: bool,
}

pub fn read(file: &str, source: &str, tree: &Tree, id: &str) -> Read {
    let root = tree.root_node();
    let mut held = Gathering {
        requests: Vec::new(),
        exports: Vec::new(),
        seen: HashSet::new(),
        broken: false,
    };

    // Kotlin wraps its imports in an `import_list`; Java lists them at the top.
    walk(root, source, true, &mut held);

    Read {
        requests: held.requests,
        exports: if held.exports.is_empty() {
            None
        } else {
            Some(held.exports)
        },
        unknown: held.broken.then(|| {
            format!(
                "{file} did not parse cleanly as {id}, so what it imports may be incomplete."
            )
        }),
    }
}

fn walk(node: Node, source: &str, top: bool, held: &mut Gathering) {
    for child in named_children(node) {
        let line = line_of(child);
        if child.kind() == "ERROR" || child.is_missing() {
            held.broken = true;
        }
        match child.kind() {
            "package_declaration" | "package_header" => {
                // The file's own package. Visible without an import, and the
                // edge nothing else in the file would ever produce.
                if let Some(name) = dotted(child, source) {
                    want(held, &format!("{name}{WHOLE_PACKAGE}"), "*", line);
                }
            }

            "import_list" => walk(child, source, false, held),

            "import_declaration" | "import_header" => {
                let Some(name) = dotted(child, source) else {
                    continue;
                };
                let parts = named_children(child);
                // Kotlin gives the `*` a node; Java leaves it anonymous and ends
                // the statement with a semicolon, so the text is what has to be read.
                let wide = parts.iter().any(|part| part.kind() == "wildcard_import")
                    || ends_wide(text_of(child, source));
                let alias = parts
                    .iter()
                    .find(|part| part.kind() == "import_alias")
                    .and_then(|part| named_children(*part).first().copied())
                    .map(|part| text_of(part, source).to_string());
                let last = name[name.rfind('.').map_or(0, |at| at + 1)..].to_string();
                let value = if wide {
                    format!("{name}{WHOLE_PACKAGE}")
                } else {
                    name.clone()
                };
                want(held, &value, alias.as_deref().unwrap_or(&last), line);
            }

            _ => {
                if !top {
                    continue;
                }
                if let Some(name) = declared(child, source) {
                    held.exports.push(Export {
                        exported: Some(name.clone()),
                        local: Some(name),
                        type_only: false,
                        line,
                        ..Export::default()
                    });
                }
            }
        }
    }
}

fn want(held: &mut Gathering, value: &str, local: &str, line: u32) {
    if value.is_empty() || !held.seen.insert(value.to_string()) {
        return;
    }
    held.requests.push(Request {
        value: value.to_string(),
        kind: Kind::Imports,
        bindings: vec![Binding {
            imported: local.to_string(),
            local: local.to_string(),
            type_only: false,
            line,
        }],
        line,
        // Always. See the module doc: nothing in the statement separates this
        // repository's packages from the platform's.
        guessed: true,
    });
}

/// `/\*\s*;?\s*$/` — a statement whose last written character is a wildcard.
fn ends_wide(text: &str) -> bool {
    let mut rest = text.trim_end();
    if let Some(cut) = rest.strip_suffix(';') {
        rest = cut.trim_end();
    }
    rest.ends_with('*')
}

/// Declarations a file publishes to its package and to anything importing it.
const DECLARATIONS: [&str; 9] = [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
    "annotation_type_declaration",
    "object_declaration",
    "function_declaration",
    "property_declaration",
    "type_alias",
];

fn declared(node: Node, source: &str) -> Option<String> {
    if !DECLARATIONS.contains(&node.kind()) {
        return None;
    }
    // Java names the field; Kotlin does not, so the first identifier-shaped
    // child is the name. Both are the node's own name and never a nested one.
    if let Some(field) = node.child_by_field_name("name") {
        return Some(text_of(field, source).to_string());
    }
    named_children(node)
        .into_iter()
        .find(|child| child.kind() == "type_identifier" || child.kind() == "simple_identifier")
        .map(|child| text_of(child, source).to_string())
}

/// The dotted name inside a package or import statement, however it is spelled.
fn dotted(node: Node, source: &str) -> Option<String> {
    let name = named_children(node)
        .into_iter()
        .find(|child| child.kind() == "scoped_identifier" || child.kind() == "identifier")?;
    // Kotlin's `identifier` holds `simple_identifier` children with the dots
    // between them as anonymous nodes, so its own text is already the dotted
    // name. Java's `scoped_identifier` is the same shape. Whitespace is possible
    // in neither, but a line break inside one would be, so it is taken out.
    let text: String = text_of(name, source)
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    (!text.is_empty()).then_some(text)
}
