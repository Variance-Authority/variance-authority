//! Names published by a declaration package through `export = Namespace`.

use oxc_allocator::Allocator;
use oxc_ast::ast::{Statement, TSNamespaceDeclarationBody};
use oxc_parser::Parser;
use oxc_span::SourceType;
use regex::Regex;

use crate::harvest::TextSpan;
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

pub(crate) fn exported_namespace(file: &str, source: &str) -> Vec<NamespaceSymbol> {
    let Ok(expression) = Regex::new(r"(?m)^\s*export\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*;") else { return Vec::new() };
    let Some(namespace) = expression.captures(source).and_then(|found| found.get(1).map(|name| name.as_str().to_owned())) else {
        return Vec::new();
    };
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(file).unwrap_or_else(|_| SourceType::ts());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let mut answer = Vec::new();
    for statement in &parsed.program.body {
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
    let direct = read_module(file, source, &Allocator::default(), true);
    let utf16: Vec<u16> = source.encode_utf16().collect();
    for symbol in direct.symbols.into_iter().filter(|symbol| symbol.name == namespace) {
        answer.push(NamespaceSymbol { name: symbol.name, kind: symbol.kind.to_owned(), line: symbol.line,
            signature: text(&utf16, symbol.signature), doc: doc(&utf16, symbol.doc) });
    }
    answer
}

/** A declaration that assigns an imported module to its public export. */
pub(crate) fn exported_import(source: &str) -> Vec<String> {
    let Ok(import_equals) = Regex::new(r#"(?m)^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)"#)
        else { return Vec::new() };
    import_equals.captures_iter(source).filter_map(|found| {
        let (local, request) = (found.get(1)?, found.get(2)?);
        source.contains(&format!("export = {};", local.as_str())).then(|| request.as_str().to_owned())
    }).collect()
}
