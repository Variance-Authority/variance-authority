//! How a Rust file spells a type: the path a line writes, placed in the
//! inline module the line sits in.
//!
//! A path is kept as written, `shapes::Props` as well as `Props`, since which
//! declaration it names is the join's to answer through the `use` that binds
//! its head. Inside `mod a { … }`, a name `a` declares is `a::Props`, as a
//! line outside the module writes it, `self::` is the module itself and each
//! `super::` climbs one module out; a name the module does not declare came in
//! by a `use`, and is kept as written.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use tree_sitter::{Node, Tree};

use super::{named_children, text_of};

/// The pointers whose fields a field expression reaches through auto-deref,
/// as the standard library names them.
const POINTERS: [&str; 3] = ["Box", "Rc", "Arc"];

/// Item kinds a module declares a type by.
const TYPES: [&str; 4] = ["struct_item", "enum_item", "union_item", "type_item"];

/// The type names each inline module of a file declares, by the module's path
/// inside the file.
pub type Inline = HashMap<Vec<String>, HashSet<String>>;

/// Every inline module `tree` declares, nested ones by their whole path.
pub fn inline_modules(tree: &Tree, source: &str) -> Inline {
    let mut found = Inline::new();
    gather(tree.root_node(), source, &mut Vec::new(), &mut found);
    found
}

fn gather(node: Node, source: &str, module: &mut Vec<String>, found: &mut Inline) {
    for child in named_children(node) {
        match child.kind() {
            "mod_item" => {
                let (Some(name), Some(body)) = (child.child_by_field_name("name"), child.child_by_field_name("body")) else { continue };
                module.push(text_of(name, source).to_owned());
                found.entry(module.clone()).or_default();
                gather(body, source, module, found);
                module.pop();
            }
            kind if TYPES.contains(&kind) && !module.is_empty() => {
                if let Some(name) = child.child_by_field_name("name") {
                    found.entry(module.clone()).or_default().insert(text_of(name, source).to_owned());
                }
            }
            _ => {}
        }
    }
}

/// Where a line is: the type `Self` is there, if any, and the inline module.
#[derive(Clone, Copy)]
pub struct Here<'a> {
    pub own: Option<&'a str>,
    pub module: &'a [String],
    pub inline: &'a Inline,
}

impl Here<'_> {
    /// A type declared here by `name`, as a line outside the module names it.
    pub fn declared(&self, name: &str) -> String {
        if self.module.is_empty() { return name.to_owned(); }
        format!("{}::{name}", self.module.join("::"))
    }
}

/// The type a type annotation names, as the path it is written by: a name
/// or a path to one, a reference to it, one of [`POINTERS`] of it, or a
/// generic type's own path.
pub fn annotated(node: Node, source: &str, here: Here) -> Option<String> {
    match node.kind() {
        "type_identifier" | "scoped_type_identifier" => written(node, source, here),
        "reference_type" => annotated(node.child_by_field_name("type")?, source, here),
        "generic_type" => {
            let base = node.child_by_field_name("type")?;
            let named = match base.kind() {
                "type_identifier" => Some(base),
                "scoped_type_identifier" => base.child_by_field_name("name"),
                _ => None,
            }?;
            if !POINTERS.contains(&text_of(named, source)) { return written(base, source, here); }
            let arguments = node.child_by_field_name("type_arguments")?;
            annotated(*named_children(arguments).first()?, source, here)
        }
        _ => None,
    }
}

/// A name or a path as the file writes it, placed by [`spelled_path`];
/// `None` for a path with anything but names in it.
pub fn written(node: Node, source: &str, here: Here) -> Option<String> {
    let mut names = Vec::new();
    let mut at = node;
    loop {
        match at.kind() {
            "identifier" | "type_identifier" | "crate" | "super" | "self" => {
                names.push(text_of(at, source));
                break;
            }
            "scoped_identifier" | "scoped_type_identifier" => {
                names.push(text_of(at.child_by_field_name("name")?, source));
                at = at.child_by_field_name("path")?;
            }
            _ => return None,
        }
    }
    names.reverse();
    spelled_path(&names, here)
}

/// The names of a path joined as written, with its head placed: `Self` as
/// the `impl`'s type, `self::` as the module the line is in, each `super::`
/// one module out of it, and a name the inline module declares under the
/// module. `None` for a `Self` outside an `impl`. A `super::` that leaves the
/// file is kept as written.
pub fn spelled_path(names: &[&str], here: Here) -> Option<String> {
    let (&head, mut rest) = names.split_first()?;
    let mut path: Vec<String> = Vec::new();
    match head {
        "Self" => path.push(here.own?.to_owned()),
        "self" if !rest.is_empty() => path.extend(here.module.iter().cloned()),
        "super" => {
            let mut up = 1;
            while rest.first() == Some(&"super") {
                up += 1;
                rest = &rest[1..];
            }
            if up > here.module.len() || rest.is_empty() { return Some(names.join("::")); }
            path.extend(here.module[..here.module.len() - up].iter().cloned());
        }
        _ if here.inline.get(here.module).is_some_and(|names| names.contains(head)) => path.push(here.declared(head)),
        _ => path.push(head.to_owned()),
    }
    path.extend(rest.iter().map(|&name| name.to_owned()));
    Some(path.join("::"))
}
