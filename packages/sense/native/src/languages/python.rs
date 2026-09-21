//! What a Python file asks for and what it publishes.
//!
//! The Rust half of [`python.ts`](../../src/python.ts), which holds the reasoning:
//! one statement is several modules, an import executes the packages above it,
//! and `if TYPE_CHECKING:` is `import type`. This file is a port of the walk and
//! nothing else — every judgement it encodes is argued there, and the two are
//! held to the same answer by a differential test.

use tree_sitter::Node;

use super::shape::{Binding, Export, Exports, Kind, Read, Requests, NAMESPACE_NAME};
use super::{children_for_field, line_of, named_children, text_of};

/// Everything a Python file's bytes say, without touching a disk.
pub fn read(file: &str, source: &str, tree: &tree_sitter::Tree) -> Read {
    let mut at = Gathering::default();
    if tree.root_node().has_error() {
        at.reasons
            .push("the parser reported an error, so what follows may stop at it".to_string());
    }

    walk(&mut at, tree.root_node(), source, false, true);

    let mut exports = match at.explicit.take() {
        None => at.exports.into_vec(),
        // `__all__` is the published set when it is written, and it is written
        // to narrow: a name the module binds and leaves out of it is not published.
        Some(named) => named
            .iter()
            .map(|name| {
                at.exports.get(name).cloned().unwrap_or(Export {
                    exported: Some(name.clone()),
                    type_only: false,
                    line: 1,
                    ..Export::default()
                })
            })
            .collect(),
    };
    exports.extend(at.opaque);

    Read {
        requests: at.requests.into_vec(),
        exports: if exports.is_empty() { None } else { Some(exports) },
        unknown: if at.reasons.is_empty() {
            None
        } else {
            Some(format!("{file} — {}", at.reasons.join("; ")))
        },
    }
}

#[derive(Default)]
struct Gathering {
    requests: Requests,
    exports: Exports,
    opaque: Vec<Export>,
    reasons: Vec<String>,
    explicit: Option<Vec<String>>,
}

/// Every package above a module path, which an import of it executes.
fn prefixes_of(value: &str) -> Vec<String> {
    let dots = leading_dots(value);
    let parts: Vec<&str> = value[dots..].split('.').filter(|part| !part.is_empty()).collect();
    let stem = ".".repeat(dots);

    (0..parts.len().saturating_sub(1))
        .map(|index| format!("{stem}{}", parts[..=index].join(".")))
        .collect()
}

fn leading_dots(value: &str) -> usize {
    value.bytes().take_while(|byte| *byte == b'.').count()
}

fn walk(at: &mut Gathering, node: Node, src: &str, typing: bool, top: bool) {
    match node.kind() {
        "import_statement" => return read_import(at, node, src, typing, top),
        "import_from_statement" => return read_import_from(at, node, src, typing, top),
        "if_statement" => {
            // Only the consequence is erased. The `else:` of an `if TYPE_CHECKING:`
            // is the branch that runs.
            let condition = node.child_by_field_name("condition");
            let consequence = node.child_by_field_name("consequence");
            let guarded = typing
                || condition
                    .map(|node| has_word(text_of(node, src), "TYPE_CHECKING"))
                    .unwrap_or(false);
            for child in named_children(node) {
                let erased = match consequence {
                    Some(branch) if branch.id() == child.id() => guarded,
                    _ => typing,
                };
                let inside = top && condition.map(|node| node.id() != child.id()).unwrap_or(true);
                walk(at, child, src, erased, inside);
            }
            return;
        }
        "function_definition" | "class_definition" => {
            if top {
                publish(at, node.child_by_field_name("name"), src, line_of(node));
            }
            // A body binds nothing at module scope, but it may import.
            if let Some(body) = node.child_by_field_name("body") {
                walk(at, body, src, typing, false);
            }
            return;
        }
        "expression_statement" => {
            if top {
                read_assignment(at, node, src);
            }
        }
        "call" => read_dynamic(at, node, src, typing),
        _ => {}
    }

    // `block` keeps the scope its parent set; everything else at module level —
    // `try`, `with`, `for` — still binds at module scope.
    let inner = node.kind() == "module" || node.kind() == "block" || is_statement(node.kind());
    for child in named_children(node) {
        walk(at, child, src, typing, top && inner);
    }
}

fn is_statement(kind: &str) -> bool {
    kind.ends_with("_statement") || kind.ends_with("_clause")
}

fn read_import(at: &mut Gathering, node: Node, src: &str, typing: bool, top: bool) {
    let line = line_of(node);
    let kind = if typing { Kind::Type } else { Kind::Imports };

    for child in children_for_field(node, "name") {
        let aliased = child.kind() == "aliased_import";
        let name = if aliased { child.child_by_field_name("name") } else { Some(child) };
        let alias = if aliased { child.child_by_field_name("alias") } else { None };
        let Some(name) = name else { continue };

        let value = text_of(name, src).to_string();
        // `import a.b.c` binds `a`; `import a.b.c as x` binds `x` to `a.b.c`.
        let local = match alias {
            Some(alias) => text_of(alias, src).to_string(),
            None => value.split('.').next().unwrap_or(&value).to_string(),
        };
        at.requests.want(
            &value,
            kind,
            line,
            false,
            vec![Binding {
                imported: NAMESPACE_NAME.to_string(),
                local: local.clone(),
                type_only: typing,
                line,
            }],
        );
        for prefix in prefixes_of(&value) {
            at.requests.want(&prefix, kind, line, true, Vec::new());
        }
        if top && !typing {
            at.exports.set(
                &local,
                Export {
                    exported: Some(local.clone()),
                    from: Some(value.clone()),
                    imported: Some(NAMESPACE_NAME.to_string()),
                    type_only: false,
                    line,
                    ..Export::default()
                },
            );
        }
    }
}

fn read_import_from(at: &mut Gathering, node: Node, src: &str, typing: bool, top: bool) {
    let line = line_of(node);
    let kind = if typing { Kind::Type } else { Kind::Imports };
    let Some(module) = node.child_by_field_name("module_name") else { return };

    // As written, dots and all: the dot count is the resolution, and `.` and `..`
    // are different modules that this is the only record of.
    let value = text_of(module, src).to_string();
    let star = named_children(node).iter().any(|child| child.kind() == "wildcard_import");

    if star {
        at.requests.want(&value, kind, line, false, Vec::new());
        for prefix in prefixes_of(&value) {
            at.requests.want(&prefix, kind, line, true, Vec::new());
        }
        // Every name that module publishes is published again from here, and
        // this file never names them: a published set with no name in it, which
        // is *not knowable* rather than empty.
        if top {
            at.opaque.push(Export {
                from: Some(value.clone()),
                type_only: false,
                line,
                ..Export::default()
            });
        }
        return;
    }

    let mut bindings: Vec<Binding> = Vec::new();
    let mut guesses: Vec<String> = Vec::new();
    for child in children_for_field(node, "name") {
        let aliased = child.kind() == "aliased_import";
        let name = if aliased { child.child_by_field_name("name") } else { Some(child) };
        let alias = if aliased { child.child_by_field_name("alias") } else { None };
        let Some(name) = name else { continue };

        let imported = text_of(name, src).to_string();
        let local = match alias {
            Some(alias) => text_of(alias, src).to_string(),
            None => imported.clone(),
        };
        bindings.push(Binding {
            imported: imported.clone(),
            local: local.clone(),
            type_only: typing,
            line,
        });
        // `import x` after a dotted module needs no separator; `from . import x`
        // does not get one either, because the dots are the separator.
        guesses.push(if value.ends_with('.') {
            format!("{value}{imported}")
        } else {
            format!("{value}.{imported}")
        });
        if top && !typing {
            at.exports.set(
                &local,
                Export {
                    exported: Some(local.clone()),
                    from: Some(value.clone()),
                    imported: Some(imported),
                    type_only: false,
                    line,
                    ..Export::default()
                },
            );
        }
    }

    at.requests.want(&value, kind, line, false, bindings);
    for prefix in prefixes_of(&value) {
        at.requests.want(&prefix, kind, line, true, Vec::new());
    }
    for guess in guesses {
        at.requests.want(&guess, kind, line, true, Vec::new());
    }
}

fn read_assignment(at: &mut Gathering, node: Node, src: &str) {
    for child in named_children(node) {
        if child.kind() != "assignment" {
            continue;
        }
        let Some(left) = child.child_by_field_name("left") else { continue };

        if text_of(left, src) == "__all__" {
            let named = match child.child_by_field_name("right") {
                None => Vec::new(),
                Some(right) => strings_in(right, src),
            };
            // A computed `__all__` is not a narrowing this can read. Falling back
            // to the bound names over-reports the published set, which costs a
            // lookup; reading it as empty would report a module as publishing nothing.
            at.explicit = if named.is_empty() { None } else { Some(named) };
            continue;
        }

        if left.kind() == "identifier" {
            publish(at, Some(left), src, line_of(child));
        }
    }
}

fn strings_in(node: Node, src: &str) -> Vec<String> {
    if node.kind() == "string" {
        return named_children(node)
            .into_iter()
            .filter(|child| child.kind() == "string_content")
            .map(|child| text_of(child, src).to_string())
            .collect();
    }
    named_children(node)
        .into_iter()
        .flat_map(|child| strings_in(child, src))
        .collect()
}

/// Record a name this module binds at top level.
///
/// Leading-underscore names are left out, which is the convention
/// `from x import *` itself obeys and the only published-set rule the language
/// has in the absence of `__all__`.
fn publish(at: &mut Gathering, name: Option<Node>, src: &str, line: u32) {
    let Some(name) = name else { return };
    let text = text_of(name, src);
    if text.starts_with('_') {
        return;
    }
    at.exports.set(
        text,
        Export {
            exported: Some(text.to_string()),
            local: Some(text.to_string()),
            type_only: false,
            line,
            ..Export::default()
        },
    );
}

/// `importlib.import_module('a.b')` and `__import__('a.b')`, literal or not.
fn read_dynamic(at: &mut Gathering, node: Node, src: &str, typing: bool) {
    let Some(callee) = node.child_by_field_name("function") else { return };

    let name = text_of(callee, src);
    if name != "__import__" && !name.ends_with("importlib.import_module") && name != "import_module"
    {
        return;
    }

    let line = line_of(node);
    let first = node
        .child_by_field_name("arguments")
        .and_then(|arguments| named_children(arguments).into_iter().next());
    let Some(first) = first else { return };

    if first.kind() == "string" {
        let literal = strings_in(first, src).join("");
        if !literal.is_empty() {
            at.requests.want(
                &literal,
                if typing { Kind::Type } else { Kind::Dynamic },
                line,
                false,
                Vec::new(),
            );
            for prefix in prefixes_of(&literal) {
                at.requests.want(&prefix, Kind::Dynamic, line, true, Vec::new());
            }
            return;
        }
    }

    at.reasons
        .push(format!("{name}(…) on line {line} names a module this cannot read"));
}

/// `\bWORD\b` without a regex, over text that is usually a few characters long.
fn has_word(haystack: &str, word: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut from = 0;
    while let Some(at) = haystack[from..].find(word) {
        let start = from + at;
        let end = start + word.len();
        let before = start == 0 || !is_word_byte(bytes[start - 1]);
        let after = end == bytes.len() || !is_word_byte(bytes[end]);
        if before && after {
            return true;
        }
        from = start + 1;
    }
    false
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
