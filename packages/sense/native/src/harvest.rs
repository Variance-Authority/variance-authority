//! Top-level declaration facts reduced while OXC's arena is still resident.

use std::collections::HashMap;

use oxc_ast::ast::{
    Declaration, ExportDefaultDeclarationKind, Expression, Program, Statement,
    VariableDeclarationKind, VariableDeclarator,
};
use oxc_span::{GetSpan, Span};
use serde::Serialize;

use crate::read::Lines;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct TextSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SourceSymbol {
    pub name: String,
    pub kind: &'static str,
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<TextSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<TextSpan>,
}

struct Offsets {
    utf16: Option<Vec<u32>>,
}

impl Offsets {
    fn new(source: &str) -> Self {
        if source.is_ascii() {
            return Self { utf16: None };
        }
        let mut offsets = vec![0; source.len() + 1];
        let mut units = 0u32;
        for (byte, character) in source.char_indices() {
            offsets[byte] = units;
            units += character.len_utf16() as u32;
            offsets[byte + character.len_utf8()] = units;
        }
        Self {
            utf16: Some(offsets),
        }
    }

    fn at(&self, byte: u32) -> u32 {
        self.utf16
            .as_ref()
            .and_then(|offsets| offsets.get(byte as usize).copied())
            .unwrap_or(byte)
    }

    fn span(&self, span: Span) -> TextSpan {
        TextSpan {
            start: self.at(span.start),
            end: self.at(span.end),
        }
    }
}

pub struct Harvest {
    pub symbols: Vec<SourceSymbol>,
    docs: HashMap<u32, TextSpan>,
    offsets: Offsets,
}

impl Harvest {
    pub fn new(program: &Program<'_>, source: &str, lines: &Lines, symbols: bool) -> Self {
        let offsets = Offsets::new(source);
        let mut docs = HashMap::new();
        for comment in &program.comments {
            let start = comment.span.start as usize;
            if !comment.is_block()
                || !source
                    .as_bytes()
                    .get(start..start + 3)
                    .is_some_and(|value| value == b"/**")
            {
                continue;
            }
            let mut subject = comment.span.end as usize;
            while let Some(character) = source.get(subject..).and_then(|rest| rest.chars().next()) {
                if !character.is_whitespace() {
                    break;
                }
                subject += character.len_utf8();
            }
            docs.insert(
                subject as u32,
                offsets.span(Span::new(comment.span.start + 2, comment.span.end - 2)),
            );
        }

        let mut harvest = Self {
            symbols: Vec::new(),
            docs,
            offsets,
        };
        if symbols {
            for statement in &program.body {
                harvest.statement(statement, lines);
            }
        }
        harvest
    }

    pub fn span(&self, span: Span) -> TextSpan {
        self.offsets.span(span)
    }

    pub fn doc(&self, at: u32) -> Option<TextSpan> {
        self.docs.get(&at).copied()
    }

    fn statement(&mut self, statement: &Statement<'_>, lines: &Lines) {
        let span = statement.span();
        let line = lines.at(span.start);
        let doc = self.doc(span.start);
        match statement {
            Statement::ExportDeclaration(exported) => {
                self.declaration(&exported.declaration, line, doc)
            }
            Statement::ExportDefaultDeclaration(exported) => {
                self.default_export(&exported.declaration, line, doc)
            }
            Statement::VariableDeclaration(declaration) => self.variables(declaration, line, doc),
            Statement::FunctionDeclaration(function) => {
                if let Some(id) = &function.id {
                    self.push(
                        id.name.to_string(),
                        "function",
                        line,
                        doc,
                        Some(Span::new(
                            function.span.start,
                            function
                                .body
                                .as_ref()
                                .map_or(function.span.end, |body| body.span.start),
                        )),
                    );
                }
            }
            Statement::ClassDeclaration(class) => {
                if let Some(id) = &class.id {
                    self.push(
                        id.name.to_string(),
                        "class",
                        line,
                        doc,
                        Some(Span::new(class.span.start, class.body.span.start)),
                    );
                }
            }
            Statement::TSTypeAliasDeclaration(alias) => self.push(
                alias.id.name.to_string(),
                "type",
                line,
                doc,
                Some(alias.span),
            ),
            Statement::TSInterfaceDeclaration(interface) => self.push(
                interface.id.name.to_string(),
                "interface",
                line,
                doc,
                Some(Span::new(interface.span.start, interface.body.span.start)),
            ),
            Statement::TSEnumDeclaration(enumeration) => self.push(
                enumeration.id.name.to_string(),
                "enum",
                line,
                doc,
                Some(Span::new(
                    enumeration.span.start,
                    enumeration.body.span.start,
                )),
            ),
            Statement::TSNamespaceDeclaration(namespace) => self.push(
                namespace.id.name.to_string(),
                "namespace",
                line,
                doc,
                Some(Span::new(namespace.span.start, namespace.body.span().start)),
            ),
            _ => {}
        }
    }

    fn declaration(&mut self, declaration: &Declaration<'_>, line: u32, doc: Option<TextSpan>) {
        match declaration {
            Declaration::VariableDeclaration(value) => self.variables(value, line, doc),
            Declaration::FunctionDeclaration(value) => {
                if let Some(id) = &value.id {
                    self.push(
                        id.name.to_string(),
                        "function",
                        line,
                        doc,
                        Some(Span::new(
                            value.span.start,
                            value
                                .body
                                .as_ref()
                                .map_or(value.span.end, |body| body.span.start),
                        )),
                    );
                }
            }
            Declaration::ClassDeclaration(value) => {
                if let Some(id) = &value.id {
                    self.push(
                        id.name.to_string(),
                        "class",
                        line,
                        doc,
                        Some(Span::new(value.span.start, value.body.span.start)),
                    );
                }
            }
            Declaration::TSTypeAliasDeclaration(value) => self.push(
                value.id.name.to_string(),
                "type",
                line,
                doc,
                Some(value.span),
            ),
            Declaration::TSInterfaceDeclaration(value) => self.push(
                value.id.name.to_string(),
                "interface",
                line,
                doc,
                Some(Span::new(value.span.start, value.body.span.start)),
            ),
            Declaration::TSEnumDeclaration(value) => self.push(
                value.id.name.to_string(),
                "enum",
                line,
                doc,
                Some(Span::new(value.span.start, value.body.span.start)),
            ),
            Declaration::TSNamespaceDeclaration(value) => self.push(
                value.id.name.to_string(),
                "namespace",
                line,
                doc,
                Some(Span::new(value.span.start, value.body.span().start)),
            ),
            _ => {}
        }
    }

    fn variables(
        &mut self,
        declaration: &oxc_ast::ast::VariableDeclaration<'_>,
        line: u32,
        doc: Option<TextSpan>,
    ) {
        let kind = match declaration.kind {
            VariableDeclarationKind::Var => "var",
            VariableDeclarationKind::Let => "let",
            VariableDeclarationKind::Const => "const",
            VariableDeclarationKind::Using => "using",
            VariableDeclarationKind::AwaitUsing => "await using",
        };
        for declarator in &declaration.declarations {
            let end = declarator_end(declarator);
            for id in declarator.id.get_binding_identifiers() {
                self.push(
                    id.name.to_string(),
                    kind,
                    line,
                    doc,
                    Some(Span::new(declaration.span.start, end)),
                );
            }
        }
    }

    fn default_export(
        &mut self,
        declaration: &ExportDefaultDeclarationKind<'_>,
        line: u32,
        doc: Option<TextSpan>,
    ) {
        match declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(value) => {
                let signature = Span::new(
                    value.span.start,
                    value
                        .body
                        .as_ref()
                        .map_or(value.span.end, |body| body.span.start),
                );
                self.push("default".to_owned(), "function", line, doc, Some(signature));
                if let Some(id) = &value.id {
                    self.push(id.name.to_string(), "function", line, doc, Some(signature));
                }
            }
            ExportDefaultDeclarationKind::ClassDeclaration(value) => {
                let signature = Span::new(value.span.start, value.body.span.start);
                self.push("default".to_owned(), "class", line, doc, Some(signature));
                if let Some(id) = &value.id {
                    self.push(id.name.to_string(), "class", line, doc, Some(signature));
                }
            }
            ExportDefaultDeclarationKind::TSInterfaceDeclaration(value) => {
                let signature = Span::new(value.span.start, value.body.span.start);
                self.push(
                    "default".to_owned(),
                    "interface",
                    line,
                    doc,
                    Some(signature),
                );
                self.push(
                    value.id.name.to_string(),
                    "interface",
                    line,
                    doc,
                    Some(signature),
                );
            }
            ExportDefaultDeclarationKind::FunctionExpression(value) => self.push(
                "default".to_owned(),
                "function",
                line,
                doc,
                Some(Span::new(
                    value.span.start,
                    value
                        .body
                        .as_ref()
                        .map_or(value.span.end, |body| body.span.start),
                )),
            ),
            ExportDefaultDeclarationKind::ArrowFunctionExpression(value) => self.push(
                "default".to_owned(),
                "function",
                line,
                doc,
                Some(Span::new(value.span.start, value.body.span().start)),
            ),
            ExportDefaultDeclarationKind::ClassExpression(value) => self.push(
                "default".to_owned(),
                "class",
                line,
                doc,
                Some(Span::new(value.span.start, value.body.span.start)),
            ),
            ExportDefaultDeclarationKind::ObjectExpression(_)
            | ExportDefaultDeclarationKind::ArrayExpression(_) => {
                self.push("default".to_owned(), "object", line, doc, None)
            }
            ExportDefaultDeclarationKind::Identifier(_) => {}
            _ => self.push("default".to_owned(), "const", line, doc, None),
        }
    }

    fn push(
        &mut self,
        name: String,
        kind: &'static str,
        line: u32,
        doc: Option<TextSpan>,
        signature: Option<Span>,
    ) {
        self.symbols.push(SourceSymbol {
            name,
            kind,
            line,
            signature: signature.map(|span| self.span(span)),
            doc,
        });
    }
}

fn declarator_end(declarator: &VariableDeclarator<'_>) -> u32 {
    match &declarator.init {
        Some(Expression::ArrowFunctionExpression(value)) => value.body.span().start,
        Some(Expression::FunctionExpression(value)) => value
            .body
            .as_ref()
            .map_or(value.span.end, |body| body.span.start),
        _ => declarator
            .type_annotation
            .as_ref()
            .map_or(declarator.id.span().end, |annotation| annotation.span.end),
    }
}
