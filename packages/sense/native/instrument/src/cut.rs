//! The cut: parse, walk, digest and splice without the tree crossing.
//!
//! What leaves is the instrumented text and the regions it was cut into. The
//! header is not part of the cut: [`crate::header`] writes it, and
//! [`Cut::header_byte`] is where it goes.

use std::cell::RefCell;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use sha2::{Digest, Sha256};

use crate::digest;
use crate::walk::{Block, Edit, Kind, Walker};

pub struct Cut {
    /// The source with every probe spliced in, and no header.
    pub code: String,
    /// Where the header goes in `code`, in UTF-16 code units.
    pub header_at: u32,
    /// Where the header goes in `code`, in bytes.
    pub header_byte: usize,
    pub source_digest: String,
    /// Block offsets are UTF-16 code units into the original source.
    pub blocks: Vec<Block>,
    pub digests: Vec<String>,
}

/// Calls vitest hoists above everything, so a header must not land in front of them.
const HOISTED: [&str; 4] = ["mock", "doMock", "unmock", "hoisted"];
const RUNNERS: [&str; 4] = ["vi", "jest", "rs", "rstest"];

thread_local! {
    static ARENA: RefCell<Allocator> = RefCell::new(Allocator::new());
}

/// Cut one module, or nothing when the source does not parse.
pub fn cut(source: &str, file: &str, entries: bool) -> Option<Cut> {
    ARENA.with(|arena| {
        let mut arena = arena.borrow_mut();
        let out = cut_in(&arena, source, file, entries);
        arena.reset();
        out
    })
}

fn cut_in(allocator: &Allocator, source: &str, file: &str, entries: bool) -> Option<Cut> {
    // The JavaScript parser falls back the same way for an extension it does not know.
    let source_type = SourceType::from_path(file).unwrap_or_default();
    let parsed = Parser::new(allocator, source, source_type).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let program = &parsed.program;

    let mut walker = walk(program, source_type.is_typescript(), entries);

    let prologue = prologue_end(program);
    // The window closes after the last top-level statement, never at the end of the text.
    let last = match (program.body.last(), program.directives.last()) {
        (Some(statement), _) => statement.span().end,
        (None, Some(directive)) => directive.span.end,
        (None, None) => prologue,
    };
    let from = walker.texts.len() as u32;
    walker.texts.push_str(";__vaE();");
    walker.edits.push(Edit { at: prologue.max(last), from, to: walker.texts.len() as u32 });

    // Stable, so an inner closer pushed first stays in front of an outer one.
    walker.edits.sort_by_key(|edit| edit.at);

    let mut code = String::with_capacity(source.len() + walker.texts.len());
    let mut read = 0usize;
    let mut before = 0u32;
    for edit in &walker.edits {
        code.push_str(&source[read..edit.at as usize]);
        code.push_str(&walker.texts[edit.from as usize..edit.to as usize]);
        read = edit.at as usize;
        if edit.at < prologue {
            before += edit.to - edit.from;
        }
    }
    code.push_str(&source[read..]);

    // A module that is all prologue takes its header on the line of its last
    // statement, which may end without a semicolon: `export * from './a'`
    // followed by `var __vaK` is not a program. A module that is only a
    // hashbang would take it inside that comment and record nothing. The
    // separator makes each a program that runs its header.
    let tail = prologue > 0 && program.body.iter().all(is_prologue);
    let separator = match &program.hashbang {
        Some(hashbang) if tail && hashbang.span.end == prologue => "\n",
        _ if tail && !source[..prologue as usize].ends_with(';') => ";",
        _ => "",
    };
    code.insert_str((prologue + before) as usize, separator);
    before += separator.len() as u32;

    let header_byte = (prologue + before) as usize;
    let digests = own_digests(source, &walker.blocks);
    let mut blocks = walker.blocks;
    let mut header_at = prologue;
    if !source.is_ascii() {
        let table = Utf16::new(source);
        header_at = table.at(header_at);
        for block in &mut blocks {
            block.start = table.at(block.start);
            block.end = table.at(block.end);
        }
    }

    Some(Cut {
        code,
        header_at: header_at + before,
        header_byte,
        source_digest: digest::of_string(source),
        blocks,
        digests,
    })
}

/// UTF-8 byte offsets to UTF-16 code units, for a source that is not ASCII.
///
/// oxc's own converter is behind its `serialize` feature, which brings serde
/// into every AST type; this is the part of it this file needs.
struct Utf16 {
    /// `(byte offset after a character, code units saved before it)`, in order.
    steps: Vec<(u32, u32)>,
}

impl Utf16 {
    fn new(source: &str) -> Self {
        let mut steps = Vec::new();
        let mut saved = 0u32;
        for (at, character) in source.char_indices() {
            let (bytes, units) = (character.len_utf8() as u32, character.len_utf16() as u32);
            if bytes != units {
                saved += bytes - units;
                steps.push((at as u32 + bytes, saved));
            }
        }
        Self { steps }
    }

    fn at(&self, offset: u32) -> u32 {
        let passed = self.steps.partition_point(|&(end, _)| end <= offset);
        offset - if passed == 0 { 0 } else { self.steps[passed - 1].1 }
    }
}

/// The walk over a program another parse made, from its module region down.
pub(crate) fn walk(program: &Program, typescript: bool, entries: bool) -> Walker {
    let mut walker = Walker::new(entries);
    let start = if typescript { typescript_start(program) } else { program.span.start };
    walker.open(Kind::Module, "module", start, program.span.end, None);
    walker.list(&program.body, "", 0);
    walker
}

/// Where TypeScript-ESTree says a program starts: the first directive or
/// statement, or a decorator in front of an exported class. Recordings made
/// when the walk read that tree carry this offset, so it stays.
fn typescript_start(program: &Program) -> u32 {
    if let Some(directive) = program.directives.first() {
        return directive.span.start;
    }
    let Some(first) = program.body.first() else { return program.span.end };
    let start = first.span().start;
    let class = match first {
        Statement::ExportDeclaration(it) => match &it.declaration {
            Declaration::ClassDeclaration(class) => Some(class),
            _ => None,
        },
        Statement::ExportDefaultDeclaration(it) => match &it.declaration {
            ExportDefaultDeclarationKind::ClassDeclaration(class) => Some(class),
            _ => None,
        },
        _ => None,
    };
    match class.and_then(|class| class.decorators.first()) {
        Some(decorator) => start.min(decorator.span.start),
        None => start,
    }
}

/// Hash the source one region owns, not the source nested regions own.
fn own_digests(source: &str, blocks: &[Block]) -> Vec<String> {
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); blocks.len()];
    for (index, block) in blocks.iter().enumerate() {
        if let Some(owner) = block.owner {
            children[owner as usize].push(index);
        }
    }

    let bytes = source.as_bytes();
    let mut owned: Vec<u8> = Vec::new();
    blocks
        .iter()
        .enumerate()
        .map(|(ordinal, block)| {
            let nested = &mut children[ordinal];
            nested.sort_by(|&l, &r| {
                let (l, r) = (&blocks[l], &blocks[r]);
                l.start.cmp(&r.start).then(r.end.cmp(&l.end))
            });

            owned.clear();
            owned.extend_from_slice(kind_name(block.kind).as_bytes());
            owned.push(0);
            let mut at = block.start;
            for &child in nested.iter() {
                let child = &blocks[child];
                if child.start < at || child.start < block.start || child.end > block.end {
                    continue;
                }
                owned.extend_from_slice(&bytes[at as usize..child.start as usize]);
                owned.push(0);
                for part in [kind_name(child.kind), ":", &child.name, ":", &child.path] {
                    owned.extend_from_slice(part.as_bytes());
                }
                owned.push(0);
                at = child.end;
            }
            if at < block.end {
                owned.extend_from_slice(&bytes[at as usize..block.end as usize]);
            }
            digest::of_sha256(Sha256::digest(&owned).as_slice())
        })
        .collect()
}

pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Module => "module",
        Kind::Function => "function",
        Kind::Branch => "branch",
        Kind::Continuation => "continuation",
        Kind::Resume => "resume",
        Kind::Loop => "loop",
        Kind::Case => "case",
        Kind::Handler => "handler",
    }
}

/// The offset after the last statement nothing may be inserted in front of.
fn prologue_end(program: &Program) -> u32 {
    let mut at = program.hashbang.as_ref().map_or(0, |hashbang| hashbang.span.end);
    if let Some(directive) = program.directives.last() {
        at = directive.span.end;
    }
    for statement in &program.body {
        if !is_prologue(statement) {
            return statement.span().start;
        }
        at = statement.span().end;
    }
    at
}

fn is_prologue(statement: &Statement) -> bool {
    match statement {
        Statement::ImportDeclaration(_)
        | Statement::ExportAllDeclaration(_)
        | Statement::ExportFromDeclaration(_)
        | Statement::TSImportEqualsDeclaration(_) => true,
        Statement::ExpressionStatement(it) => match &it.expression {
            Expression::StringLiteral(_) => true,
            expression => is_hoisted_call(Some(expression)),
        },
        // `const spy = vi.hoisted(() => …)` moves with the mocks.
        Statement::VariableDeclaration(it) => {
            it.declarations.iter().all(|declarator| is_hoisted_call(declarator.init.as_ref()))
        }
        _ => false,
    }
}

fn is_hoisted_call(expression: Option<&Expression>) -> bool {
    let Some(Expression::CallExpression(call)) = expression else { return false };
    let (object, property) = match &call.callee {
        Expression::StaticMemberExpression(it) => (&it.object, it.property.name.as_str()),
        Expression::ComputedMemberExpression(it) => match &it.expression {
            Expression::Identifier(property) => (&it.object, property.name.as_str()),
            _ => return false,
        },
        Expression::PrivateFieldExpression(it) => (&it.object, it.field.name.as_str()),
        _ => return false,
    };
    let Expression::Identifier(object) = object else { return false };
    RUNNERS.contains(&object.name.as_str()) && HOISTED.contains(&property)
}
