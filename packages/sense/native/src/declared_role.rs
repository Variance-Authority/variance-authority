//! The role a doc comment declares for the name it documents.
//!
//! Two modifier tags of our own, read wherever an export's doc is read:
//! `@testOnly` says only tests may run the name, so a shipped file that imports
//! it is a defect; `@production` says the name is shipped code however many
//! tests use it. Neither is a TSDoc release tag, because `@public` and
//! `@internal` already mean something to API Extractor and the docs, and
//! declaring a role must not change what another tool does.
//!
//! The tag is read off the doc the export statement carries, and for
//! `const x = …; export { x }` off the doc of the statement that declares `x`,
//! which is where a reader writes it.

use std::collections::HashMap;

use oxc_ast::ast::{Program, Statement};
use oxc_span::GetSpan;

/// `@testOnly`: only tests may run it.
pub const TEST_ONLY: u8 = 1;
/// `@production`: shipped code, whatever share of its users are tests.
pub const PRODUCTION: u8 = 2;

/// The names `Export.roles` carries the bits under, in bit order.
const NAMES: [(u8, &str); 2] = [(TEST_ONLY, "testOnly"), (PRODUCTION, "production")];

/// Writes role bits as the names a reader of `Export.roles` sees.
pub(crate) fn serialize<S: serde::Serializer>(tags: &u8, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_seq(NAMES.iter().filter(|(bit, _)| tags & bit != 0).map(|(_, name)| name))
}

/// Reads `Export.roles` back into bits; a name this addon does not know is refused.
pub(crate) fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    let names = <Vec<String> as serde::Deserialize>::deserialize(deserializer)?;
    names.iter().try_fold(0, |tags, name| match NAMES.iter().find(|(_, known)| known == name) {
        Some((bit, _)) => Ok(tags | bit),
        None => Err(serde::de::Error::custom(format!("unknown role {name:?}"))),
    })
}

/// The role tags written in a doc comment's text, as bits.
///
/// A tag is `@` and its name standing alone: after whitespace, the `*` that
/// opens a line, or the start; before whitespace or the end. So `` `@testOnly` ``
/// in prose and `@testOnlyFor` are not tags, and neither is anything inside a
/// fenced code block.
pub(crate) fn tags_in(text: &str) -> u8 {
    let mut tags = 0;
    let mut fenced = false;
    for line in text.lines() {
        let body = line.trim_start().trim_start_matches('*').trim_start();
        if body.starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        for word in body.split_whitespace() {
            tags |= match word {
                "@testOnly" => TEST_ONLY,
                "@production" => PRODUCTION,
                _ => 0,
            };
        }
    }
    tags
}

/// The roles one module's docs declare, by where the documented statement
/// starts and by the names declared there.
pub(crate) struct DeclaredRoles {
    at: HashMap<u32, u8>,
    names: HashMap<String, u8>,
}

impl DeclaredRoles {
    /// `tagged` maps a documented statement's start to the tags its doc holds,
    /// as `Harvest` found them. A module whose docs declare nothing walks
    /// nothing.
    pub(crate) fn new(program: &Program<'_>, tagged: HashMap<u32, u8>) -> Self {
        let mut names = HashMap::new();
        if !tagged.is_empty() {
            for statement in &program.body {
                let Some(&tags) = tagged.get(&statement.span().start) else { continue };
                for name in declared(statement) {
                    names.insert(name, tags);
                }
            }
        }
        Self { at: tagged, names }
    }

    /// The tags on an export statement starting at `statement`, or on the
    /// declaration of `local` when the statement's own doc declares none.
    pub(crate) fn of(&self, statement: u32, local: Option<&str>) -> u8 {
        match self.at.get(&statement) {
            Some(&tags) => tags,
            None => local.and_then(|name| self.names.get(name)).copied().unwrap_or(0),
        }
    }
}

/// The names a top-level statement that is not an export declares.
fn declared(statement: &Statement<'_>) -> Vec<String> {
    let Some(declaration) = statement.as_declaration() else { return Vec::new() };
    if let oxc_ast::ast::Declaration::VariableDeclaration(variables) = declaration {
        return variables
            .declarations
            .iter()
            .flat_map(|declarator| declarator.id.get_binding_identifiers())
            .map(|id| id.name.to_string())
            .collect();
    }
    declaration.id().map(|id| vec![id.name.to_string()]).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tag_stands_alone() {
        assert_eq!(tags_in("*\n * Builds a fixture.\n * @testOnly\n "), TEST_ONLY);
        assert_eq!(tags_in(" @production "), PRODUCTION);
        assert_eq!(tags_in(" @testOnly @production "), TEST_ONLY | PRODUCTION);
    }

    #[test]
    fn prose_and_code_name_a_tag_without_writing_it() {
        assert_eq!(tags_in(" Unlike `@testOnly`, this ships. "), 0);
        assert_eq!(tags_in(" @testOnlyFor and @productionish "), 0);
        assert_eq!(tags_in("\n * ```ts\n * @testOnly\n * ```\n "), 0);
    }

    fn roles(source: &str) -> Vec<(Option<String>, u8)> {
        let allocator = oxc_allocator::Allocator::default();
        crate::read::read_module("a.ts", source, &allocator, false)
            .exports
            .into_iter()
            .map(|export| (export.exported, export.tags))
            .collect()
    }

    #[test]
    fn an_export_takes_the_role_its_statement_doc_declares() {
        let source = "/** @testOnly */
export function make() {}
/** Ships. */
export const run = 1;
";
        assert_eq!(roles(source), vec![(Some("make".into()), TEST_ONLY), (Some("run".into()), 0)]);
    }

    #[test]
    fn a_name_exported_at_the_foot_takes_the_role_its_declaration_declares() {
        let source = "/** @production */
const kept = 1;
function plain() {}
export { kept, plain };
";
        assert_eq!(roles(source), vec![(Some("kept".into()), PRODUCTION), (Some("plain".into()), 0)]);
    }

    #[test]
    fn a_role_declared_on_the_export_statement_outranks_the_declaration() {
        let source = "/** @production */
const kept = 1;
/** @testOnly */
export { kept };
";
        assert_eq!(roles(source), vec![(Some("kept".into()), TEST_ONLY)]);
    }
}
