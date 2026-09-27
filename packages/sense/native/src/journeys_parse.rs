//! One module's call sites as the journeys walk reads them: its functions in
//! the order they are written, each call with the function it is written in
//! and how many guards stand between that function's entry and the call, and
//! what the module imports, exports and declares at its top level.
//!
//! A guard is a branch (`if`/`else`, `?:`, the right of `&&`/`||`/`??`, a
//! `switch` case, a `catch`, a default value, an optional call) or a statement
//! after an early `return` or `throw` in the same list. A loop body is not one:
//! an iteration usually runs. A call with no guard runs whenever its function
//! does, which is what the walk prefers when two routes reach one function.

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};
use oxc_syntax::module_record::{ExportExportName, ExportImportName, ImportImportName};

use crate::module_shape::Lines;
use crate::read::dialect;

/// What a call names: `f()`, `ns.f()`, or `something.f()`.
#[derive(Clone, Default, Debug, PartialEq)]
pub(crate) struct Callee {
    pub id: Option<String>,
    pub ns: Option<String>,
    pub prop: Option<String>,
}

#[derive(Debug)]
pub(crate) struct Import {
    pub spec: String,
    /// The imported name: a name, `default`, or `*` for a namespace.
    pub name: String,
}

#[derive(Debug)]
pub(crate) enum Export {
    Local(String),
    From { spec: String, name: String },
}

#[derive(Debug)]
pub(crate) struct Func {
    pub line: u32,
    pub end_line: u32,
    /// Its own name, the binding or key it is assigned to, or `callee.argN`
    /// when it is handed to a call as argument N.
    pub hint: Option<String>,
    /// The first argument of the call it is handed to, when that is a string:
    /// a test's or a suite's title. A template's holes are `*`.
    pub title: Option<String>,
    pub parent: Option<u32>,
    pub start: u32,
    pub params: Vec<Option<String>>,
}

#[derive(Debug)]
pub(crate) struct Call {
    /// The function it is written in; `None` at the module's top level.
    pub from: Option<u32>,
    pub line: u32,
    /// Where the call ends, four to a byte: a callback handed to a call sorts
    /// just before it, and a function passed by name just before that.
    pub col: u64,
    pub callback: Option<u32>,
    pub guard: u32,
    pub is_new: bool,
    /// A function passed by name as an argument, which the callee may call.
    pub by_ref: bool,
    pub callee: Callee,
}

/// A module-level value that is not a function: the functions written inside
/// it run when whoever it is handed to calls them.
#[derive(Debug)]
pub(crate) struct Decl {
    pub start: u32,
    pub end: u32,
    pub made: Option<Callee>,
}

#[derive(Debug, Default)]
pub(crate) struct Parsed {
    pub imports: HashMap<String, Import>,
    pub exports: HashMap<String, Export>,
    pub star: Vec<String>,
    pub fns: Vec<Func>,
    pub calls: Vec<Call>,
    pub locals: HashMap<String, Vec<u32>>,
    pub decls: HashMap<String, Decl>,
}

/// `name.argN`: a function known only as an argument of a call.
pub(crate) fn is_argument(hint: &str) -> bool {
    hint.rfind(".arg").is_some_and(|at| {
        let digits = &hint[at + 4..];
        !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

/// `plugin.load!()`, `(fn as F)()`, `(obj.m)()`: the call of what the wrapper wraps.
fn unwrapped<'b, 'a>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSNonNullExpression(it) => &it.expression,
            Expression::ParenthesizedExpression(it) => &it.expression,
            Expression::TSAsExpression(it) => &it.expression,
            Expression::TSSatisfiesExpression(it) => &it.expression,
            Expression::TSTypeAssertion(it) => &it.expression,
            Expression::TSInstantiationExpression(it) => &it.expression,
            _ => return expression,
        };
    }
}

fn callee_of(expression: &Expression) -> Option<Callee> {
    match unwrapped(expression) {
        Expression::Identifier(it) => Some(Callee { id: Some(it.name.to_string()), ..Callee::default() }),
        Expression::StaticMemberExpression(it) => {
            let prop = Some(it.property.name.to_string());
            let ns = match &it.object {
                Expression::Identifier(object) => Some(object.name.to_string()),
                _ => None,
            };
            Some(Callee { id: None, ns, prop })
        }
        _ => None,
    }
}

/// The factory a value is the result of: `styled(A)(b)` is made by `styled`.
fn made_by(init: &Expression) -> Option<Callee> {
    let Expression::CallExpression(first) = unwrapped(init) else { return None };
    let mut call: &CallExpression = first;
    loop {
        match unwrapped(&call.callee) {
            Expression::CallExpression(inner) => call = inner,
            other => return callee_of(other),
        }
    }
}

fn is_function(expression: &Expression) -> bool {
    matches!(expression, Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_))
}

fn key_name(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(it) => Some(it.name.to_string()),
        PropertyKey::PrivateIdentifier(it) => Some(it.name.to_string()),
        PropertyKey::Identifier(it) => Some(it.name.to_string()),
        _ => None,
    }
}

fn via_of(callee: &Option<Callee>) -> Option<String> {
    callee.as_ref().and_then(|named| named.prop.clone().or_else(|| named.id.clone()))
}

/// The call a callback is handed to.
struct Site {
    line: u32,
    col: u64,
    guard: u32,
}

/// What the parent says of the function it is about to visit.
#[derive(Default)]
struct Pending {
    hint: Option<String>,
    title: Option<String>,
    site: Option<Site>,
}

struct Walker {
    lines: Lines,
    fns: Vec<Func>,
    calls: Vec<Call>,
    decls: HashMap<String, Decl>,
    stack: Vec<u32>,
    guard: u32,
    /// Whether a `return` or `throw` was seen since the enclosing statement
    /// list last reset it, not counting nested functions and class bodies.
    exited: bool,
    pending: Option<Pending>,
}

impl Walker {
    fn line(&self, offset: u32) -> u32 {
        self.lines.at(offset)
    }

    fn from(&self) -> Option<u32> {
        self.stack.last().copied()
    }

    /// Visit with one more guard than the parent.
    fn guarded(&mut self, inner: impl FnOnce(&mut Self)) {
        self.guard += 1;
        inner(self);
        self.guard -= 1;
    }

    /// Visit a child the parent names: `hint` when it is a function literal.
    fn hinted(&mut self, expression: &Expression<'_>, hint: Option<String>) {
        if is_function(expression) {
            self.pending = Some(Pending { hint, ..Pending::default() });
        }
        self.visit_expression(expression);
    }

    /// A function with a body: record it, then walk it from its own entry.
    fn function(&mut self, span: Span, id: Option<String>, params: Vec<Option<String>>, inner: impl FnOnce(&mut Self)) {
        let pending = self.pending.take().unwrap_or_default();
        let at = self.fns.len() as u32;
        let parent = self.from();
        if let (Some(from), Some(site)) = (parent, pending.site) {
            self.calls.push(Call {
                from: Some(from),
                line: site.line,
                col: site.col,
                callback: Some(at),
                guard: site.guard,
                is_new: false,
                by_ref: false,
                callee: Callee::default(),
            });
        }
        self.fns.push(Func {
            line: self.line(span.start),
            end_line: self.line(span.end),
            hint: id.or(pending.hint),
            title: pending.title,
            parent,
            start: span.start,
            params,
        });
        self.stack.push(at);
        let (guard, exited) = (self.guard, self.exited);
        self.guard = 0;
        self.exited = false;
        inner(self);
        self.guard = guard;
        self.exited = exited;
        self.stack.pop();
    }

    fn call(&mut self, span: Span, callee: Option<Callee>, arguments: &[Argument<'_>], own: u32, is_new: bool) {
        let from = self.from();
        let line = self.line(span.start);
        if let Some(callee) = callee {
            self.calls.push(Call { from, line, col: span.end as u64 * 4, callback: None, guard: own, is_new, by_ref: false, callee });
        }
        // A function passed by name (`map(doProcess)`) is a callback like an inline one: the callee may run it.
        for argument in arguments {
            let named = match argument {
                Argument::Identifier(it) => Some((it.span.start, Callee { id: Some(it.name.to_string()), ..Callee::default() })),
                Argument::StaticMemberExpression(it) => match &it.object {
                    Expression::Identifier(object) => Some((
                        it.span.start,
                        Callee { id: None, ns: Some(object.name.to_string()), prop: Some(it.property.name.to_string()) },
                    )),
                    _ => None,
                },
                _ => None,
            };
            if let Some((start, callee)) = named {
                let line = self.line(start);
                self.calls.push(Call { from, line, col: span.end as u64 * 4 - 1, callback: None, guard: own, is_new: false, by_ref: true, callee });
            }
        }
    }

    fn arguments(&mut self, span: Span, arguments: &[Argument<'_>], via: Option<String>, own: u32, titled: bool) {
        let title = if titled {
            match arguments.first() {
                Some(Argument::StringLiteral(it)) => Some(it.value.to_string()),
                Some(Argument::TemplateLiteral(it)) => {
                    Some(it.quasis.iter().map(|quasi| quasi.value.cooked.as_ref().map_or("", |cooked| cooked.as_str())).collect::<Vec<_>>().join("*"))
                }
                _ => None,
            }
        } else {
            None
        };
        let line = self.line(span.start);
        for (at, argument) in arguments.iter().enumerate() {
            if matches!(argument, Argument::FunctionExpression(_) | Argument::ArrowFunctionExpression(_)) {
                self.pending = Some(Pending {
                    hint: Some(format!("{}.arg{at}", via.as_deref().unwrap_or("?"))),
                    title: title.clone(),
                    site: Some(Site { line, col: span.end as u64 * 4 - 2, guard: own }),
                });
            }
            self.visit_argument(argument);
        }
    }

    fn params(&self, this: bool, params: &FormalParameters<'_>) -> Vec<Option<String>> {
        let mut out = Vec::with_capacity(params.items.len() + 2);
        if this {
            out.push(Some("this".to_owned()));
        }
        for param in &params.items {
            let property = param.accessibility.is_some() || param.readonly || param.r#override;
            out.push(match &param.pattern {
                BindingPattern::BindingIdentifier(it) if !property => Some(it.name.to_string()),
                _ => None,
            });
        }
        if params.rest.is_some() {
            out.push(None);
        }
        out
    }
}

#[path = "journeys_parse_visit.rs"]
mod visit;


/// One module's imports, exports and call sites; `None` when it cannot be read
/// as JavaScript or TypeScript at all.
pub(crate) fn parse(file: &str, text: &str) -> Option<Parsed> {
    let source_type = dialect(file).unwrap_or_else(SourceType::tsx);
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if parsed.panicked {
        return None;
    }
    let record = &parsed.module_record;
    let mut out = Parsed::default();
    for entry in &record.import_entries {
        if entry.is_type {
            continue;
        }
        let name = match &entry.import_name {
            ImportImportName::Name(name) => name.name.to_string(),
            ImportImportName::Default(_) => "default".to_owned(),
            ImportImportName::NamespaceObject => "*".to_owned(),
        };
        out.imports.insert(entry.local_name.name.to_string(), Import { spec: entry.module_request.name.to_string(), name });
    }
    let mut entries: Vec<_> = record
        .local_export_entries
        .iter()
        .chain(record.indirect_export_entries.iter())
        .chain(record.star_export_entries.iter())
        .collect();
    entries.sort_by_key(|entry| (entry.statement_span.start, entry.span.start));
    for entry in entries {
        if entry.is_type {
            continue;
        }
        let exported = match &entry.export_name {
            ExportExportName::Name(name) => Some(name.name.to_string()),
            ExportExportName::Default(_) => Some("default".to_owned()),
            ExportExportName::Null => None,
        };
        match &entry.module_request {
            Some(request) if matches!(entry.import_name, ExportImportName::AllButDefault) && exported.is_none() => {
                out.star.push(request.name.to_string());
            }
            Some(request) => {
                let name = match &entry.import_name {
                    ExportImportName::Name(name) => name.name.to_string(),
                    _ => "*".to_owned(),
                };
                out.exports.insert(exported.unwrap_or_else(|| "*".to_owned()), Export::From { spec: request.name.to_string(), name });
            }
            None => {
                let local = entry.local_name.name().map_or_else(|| "default".to_owned(), |name| name.to_string());
                out.exports.insert(exported.unwrap_or_else(|| "default".to_owned()), Export::Local(local));
            }
        }
    }
    let mut walker = Walker {
        lines: Lines::new(text),
        fns: Vec::new(),
        calls: Vec::new(),
        decls: HashMap::new(),
        stack: Vec::new(),
        guard: 0,
        exited: false,
        pending: None,
    };
    walker.visit_program(&parsed.program);
    for (at, func) in walker.fns.iter().enumerate() {
        if let Some(hint) = func.hint.as_deref().filter(|hint| !is_argument(hint)) {
            out.locals.entry(hint.to_owned()).or_default().push(at as u32);
        }
    }
    out.fns = walker.fns;
    out.calls = walker.calls;
    out.decls = walker.decls;
    Some(out)
}

#[cfg(test)]
#[path = "journeys_parse_tests.rs"]
mod tests;
