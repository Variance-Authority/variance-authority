//! Names published by a declaration package through `export = Namespace`.

use oxc_allocator::Allocator;
use oxc_ast::ast::{Expression, Program, Statement, TSModuleReference, TSNamespaceDeclarationBody};
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::harvest::{SourceSymbol, TextSpan};
use crate::read::read_module;

pub(crate) struct NamespaceSymbol {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub signature: Option<String>,
    pub doc: Option<String>,
}

pub(crate) fn text(source: &[u16], span: Option<TextSpan>) -> Option<String> {
    let span = span?;
    Some(String::from_utf16_lossy(source.get(span.start as usize..span.end as usize)?).trim().to_owned())
}

pub(crate) fn doc(source: &[u16], span: Option<TextSpan>) -> Option<String> {
    let raw = text(source, span)?;
    let body = raw.trim_start_matches("/**").trim_end_matches("*/");
    let lines: Vec<_> = body.lines().map(|line| line.trim().trim_start_matches('*').trim()).collect();
    let cleaned = lines.join("\n").trim().to_owned();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

/// The name a declaration file's first `export = name` statement publishes,
/// at the top level or inside a `declare module "x" { … }` body, and the
/// scopes that name resolves in: the statements around it, then the file's.
fn assigned<'p, 'a>(program: &'p Program<'a>) -> Option<(String, Vec<&'p [Statement<'a>]>)> {
    fn name(statements: &[Statement]) -> Option<String> {
        statements.iter().find_map(|statement| match statement {
            Statement::TSExportAssignment(it) => match &it.expression {
                Expression::Identifier(name) => Some(name.name.to_string()),
                _ => None,
            },
            _ => None,
        })
    }
    let top: &[Statement] = &program.body;
    top.iter().find_map(|statement| match statement {
        Statement::TSExportAssignment(_) => name(std::slice::from_ref(statement)).map(|found| (found, vec![top])),
        Statement::TSExternalModuleDeclaration(module) => {
            let inner: &[Statement] = &module.body.as_ref()?.body;
            name(inner).map(|found| (found, vec![inner, top]))
        }
        _ => None,
    })
}

/// A declaration file's tree, in the dialect its extension names: `.d.ts`,
/// `.d.mts` or `.d.cts`.
pub(crate) fn parse<'a>(file: &str, source: &'a str, allocator: &'a Allocator) -> Program<'a> {
    let dialect = SourceType::from_path(file).unwrap_or_else(|_| SourceType::ts());
    Parser::new(allocator, source, dialect).parse().program
}

/// The members of the namespace `program` assigns to its export, and the
/// namespace's own declarations among the file's `symbols`.
pub(crate) fn exported_namespace(file: &str, source: &str, program: &Program, symbols: &[SourceSymbol]) -> Vec<NamespaceSymbol> {
    let Some((namespace, scopes)) = assigned(program) else { return Vec::new() };
    let mut answer = Vec::new();
    for statement in scopes.into_iter().flatten() {
        let Statement::TSNamespaceDeclaration(declaration) = statement else { continue };
        if declaration.id.name.as_str() != namespace { continue; }
        let TSNamespaceDeclarationBody::TSModuleBlock(block) = &declaration.body else { continue };
        let Some(inner) = source.get(block.span.start as usize + 1..block.span.end as usize - 1) else { continue };
        let line_offset = source[..block.span.start as usize + 1].bytes().filter(|byte| *byte == b'\n').count() as u32;
        let read = read_module(file, inner, &Allocator::default(), true);
        let utf16: Vec<u16> = inner.encode_utf16().collect();
        for symbol in read.symbols {
            answer.push(NamespaceSymbol { name: symbol.name, kind: symbol.kind.to_owned(), line: symbol.line + line_offset,
                signature: text(&utf16, symbol.signature), doc: doc(&utf16, symbol.doc) });
        }
    }
    let utf16: Vec<u16> = source.encode_utf16().collect();
    for symbol in symbols.iter().filter(|symbol| symbol.name == namespace) {
        answer.push(NamespaceSymbol { name: symbol.name.clone(), kind: symbol.kind.to_owned(), line: symbol.line,
            signature: text(&utf16, symbol.signature), doc: doc(&utf16, symbol.doc) });
    }
    answer
}

/** A declaration that assigns an imported module to its public export. */
pub(crate) fn exported_import(program: &Program) -> Vec<String> {
    let Some((local, scopes)) = assigned(program) else { return Vec::new() };
    scopes.into_iter().flatten().filter_map(|statement| match statement {
        Statement::TSImportEqualsDeclaration(it) if it.id.name == local.as_str() => match &it.module_reference {
            TSModuleReference::ExternalModuleReference(reference) => Some(reference.expression.value.to_string()),
            _ => None,
        },
        _ => None,
    }).collect()
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;

    use super::{exported_import, exported_namespace, parse};
    use crate::read::read_module;

    fn imported(source: &str) -> Vec<String> {
        let allocator = Allocator::default();
        exported_import(&parse("index.d.ts", source, &allocator))
    }

    fn published(source: &str) -> Vec<String> {
        let symbols = read_module("index.d.ts", source, &Allocator::default(), true).symbols;
        let allocator = Allocator::default();
        let program = parse("index.d.ts", source, &allocator);
        exported_namespace("index.d.ts", source, &program, &symbols).into_iter().map(|symbol| symbol.name).collect()
    }

    #[test]
    fn an_import_assigned_to_the_export_is_read_from_code() {
        let source = "import globbing = require(\"./lib/globbing\");\nexport = globbing;\n";
        assert_eq!(imported(source), ["./lib/globbing"]);
    }

    #[test]
    fn an_import_assigned_in_a_comment_is_not_an_export() {
        assert!(imported("/*\nimport hidden = require('./hidden');\nexport = hidden;\n*/\n").is_empty());
    }

    #[test]
    fn a_namespace_assigned_in_a_comment_is_not_an_export() {
        assert!(published("/*\nexport = Kit;\n*/\ndeclare namespace Kit {\nfunction pulse(): boolean;\n}\n").is_empty());
    }

    #[test]
    fn a_namespace_assigned_in_code_publishes_its_members_however_it_is_spaced() {
        for assignment in ["export = Kit;", "export=Kit;", "export   =   Kit"] {
            let names = published(&format!("{assignment}\ndeclare namespace Kit {{\nfunction pulse(): boolean;\n}}\n"));
            assert!(names.contains(&"pulse".to_owned()), "{assignment}: {names:?}");
        }
    }

    #[test]
    fn an_import_assigned_inside_an_ambient_module_is_read() {
        let source = "declare module \"kit\" {\n    import kit = require(\"./lib/kit\");\n    export = kit;\n}\n";
        assert_eq!(imported(source), ["./lib/kit"]);
    }

    #[test]
    fn a_namespace_an_ambient_module_assigns_publishes_its_members_from_either_scope() {
        let outside = "declare namespace Kit {\nfunction pulse(): boolean;\n}\ndeclare module \"kit\" {\n    export = Kit;\n}\n";
        let inside = "declare module \"kit\" {\n    namespace Kit {\n    function pulse(): boolean;\n    }\n    export = Kit;\n}\n";
        for source in [outside, inside] {
            assert!(published(source).contains(&"pulse".to_owned()), "{source}");
        }
    }

    #[test]
    fn an_import_another_ambient_module_holds_is_not_the_one_assigned() {
        let source = "declare module \"a\" {\n    import kit = require(\"./a\");\n}\ndeclare module \"kit\" {\n    export = kit;\n}\n";
        assert!(imported(source).is_empty());
    }
}
