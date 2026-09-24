//! The walk that decides where a probe goes, and what the region behind it is called.
//!
//! Two questions, one descent, because neither can be answered without the other's
//! state: `if#1/then` is numbered within the path that contains it and against the
//! scope that opened it, and both are only known while standing in them. The rule
//! this applies — one arrival condition per region — and the vocabulary it produces
//! are in `src/instrument/spliced.ts`. This is the only walk: every recording's
//! block identities are what it answers, and `spliced.test.ts` holds it to the
//! answers committed in `src/instrument/__fixtures__/spliced-golden.ts`.
//!
//! Order is the whole contract. A block's ordinal is the order it was opened in,
//! an anonymous function's number is the order its scope saw it, and two
//! insertions at one offset land in the order they were pushed, so a traversal
//! that visits the same nodes in another order is a different recording, not a
//! faster one.
//!
//! ## Nothing is re-printed
//!
//! Every emission is an insertion at an offset in the original source. A region
//! whose body is already a block gets one splice after its `{`; a bare statement
//! body is wrapped in `{`…`}`, which is also what removes the dangling-`else`
//! hazard — a synthesized `else` can never rebind, because by the time it is
//! appended the `if` it follows always has a braced consequent.
//!
//! Closing insertions are pushed **after** the subtree is walked, so a stable sort
//! by offset puts an inner `}` in front of an outer one. `if (a) if (b) x();` grows
//! two synthesized `else` clauses at the same offset and they nest correctly for
//! that reason alone.
//!
//! ## The entries walk
//!
//! The same descent with every decision declined: an `if`, a `switch`, a `try`,
//! a loop and an `await` are stepped through as the plain statements around them
//! are, and only a module and a function open a region. What remains is the set
//! of places control can *arrive from outside* — a module evaluating, a function
//! being called — which is the whole of what a run needs to say which functions
//! ran and whether any of them ran before its first test did. Numbering, naming,
//! ownership and digests are the ordinary walk's, computed over the regions that
//! are left, so a function keeps the address it has under the full walk.
//!
//! ## Names
//!
//! A name is spelled as JavaScript would print the key: a regular expression as
//! `String(regex)`, a string as its value. A string holding a lone surrogate has
//! no UTF-8 spelling, so each one is written as `\uXXXX`; a real U+FFFD stays
//! itself.
//!
//! Offsets are UTF-8 bytes throughout. Every offset is a node boundary, so the
//! mapping to the JavaScript side's UTF-16 offsets is monotone and every
//! comparison made here in bytes answers the same there.

use std::collections::HashMap;
use std::fmt::Write;

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::number::ToJsString;
use oxc_syntax::scope::ScopeFlags;

#[path = "instrument_params.rs"]
mod params;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Module = 0,
    Function = 1,
    Branch = 2,
    Continuation = 3,
    Resume = 4,
    Loop = 5,
    Case = 6,
    Handler = 7,
}

pub struct Block {
    pub kind: Kind,
    pub owner: Option<u32>,
    pub name: String,
    pub path: String,
    pub start: u32,
    pub end: u32,
}

/// One insertion: the offset, and the range of `Walker::texts` it inserts.
#[derive(Clone, Copy)]
pub struct Edit {
    pub at: u32,
    pub from: u32,
    pub to: u32,
}

/// What a function's region is laid over.
#[derive(Clone, Copy)]
enum Body<'b, 'a> {
    None,
    Block(&'b FunctionBody<'a>),
    Expression(&'b Expression<'a>),
}

struct Scope {
    name: String,
    counts: HashMap<String, u32>,
    anon: u32,
}

impl Scope {
    fn new(name: String) -> Self {
        Self { name, counts: HashMap::new(), anon: 0 }
    }
}

pub struct Walker {
    entries: bool,
    pub blocks: Vec<Block>,
    pub edits: Vec<Edit>,
    pub texts: String,
    scopes: Vec<Scope>,
    path: String,
    owner: u32,
    hint: Option<String>,
}

impl Walker {
    pub fn new(entries: bool) -> Self {
        Self {
            entries,
            blocks: Vec::new(),
            edits: Vec::new(),
            texts: String::new(),
            scopes: vec![Scope::new(String::new())],
            path: String::new(),
            owner: 0,
            hint: None,
        }
    }

    pub fn open(&mut self, kind: Kind, path: &str, start: u32, end: u32, owner: Option<u32>) -> u32 {
        let ordinal = self.blocks.len() as u32;
        let name = self.scope().name.clone();
        self.blocks.push(Block { kind, owner, name, path: path.to_string(), start, end });
        ordinal
    }

    fn scope(&mut self) -> &mut Scope {
        self.scopes.last_mut().expect("the module scope is never popped")
    }

    fn push(&mut self, at: u32, text: std::fmt::Arguments) {
        let from = self.texts.len() as u32;
        let _ = self.texts.write_fmt(text);
        self.edits.push(Edit { at, from, to: self.texts.len() as u32 });
    }

    fn hit(&mut self, at: u32, ordinal: u32) {
        self.push(at, format_args!("__va({ordinal});"));
    }

    /// Run `f` standing at `path` under `owner`, and put both back after.
    fn at<R>(&mut self, path: &str, owner: u32, f: impl FnOnce(&mut Self) -> R) -> R {
        let outer_path = std::mem::replace(&mut self.path, path.to_string());
        let outer_owner = std::mem::replace(&mut self.owner, owner);
        let out = f(self);
        self.path = outer_path;
        self.owner = outer_owner;
        out
    }

    pub fn list(&mut self, statements: &[Statement], path: &str, owner: u32) {
        let mut current = owner;
        for (index, statement) in statements.iter().enumerate() {
            let decision = self.at(path, current, |w| w.statement(statement));
            let (Some(label), Some(next)) = (decision, statements.get(index + 1)) else {
                continue;
            };
            let last = statements.last().expect("a next statement implies a last").span().end;
            let start = next.span().start;
            let ordinal = self.at(path, current, |w| {
                w.open(Kind::Continuation, &format!("{label}/after"), start, last, Some(current))
            });
            self.hit(start, ordinal);
            current = ordinal;
        }
    }

    /// `visit` for a statement: the decision label, or nothing.
    fn statement(&mut self, statement: &Statement) -> Option<String> {
        match statement {
            Statement::IfStatement(it) if !self.entries => Some(self.branch(it)),
            Statement::SwitchStatement(it) if !self.entries => Some(self.switched(it)),
            Statement::TryStatement(it) if !self.entries => Some(self.guarded(it)),
            Statement::ForStatement(_)
            | Statement::ForInStatement(_)
            | Statement::ForOfStatement(_)
            | Statement::WhileStatement(_)
            | Statement::DoWhileStatement(_)
                if !self.entries =>
            {
                Some(self.looped(statement))
            }
            Statement::LabeledStatement(it) => self.statement(&it.body),
            _ => {
                walk::walk_statement(self, statement);
                None
            }
        }
    }

    /// The region head: returns the ordinal and, for a bare statement, the closer's offset.
    fn enter(&mut self, span: (u32, u32), block: bool, kind: Kind, path: &str) -> (u32, Option<u32>) {
        let owner = self.owner;
        let ordinal = self.open(kind, path, span.0, span.1, Some(owner));
        if block {
            self.hit(span.0 + 1, ordinal);
            return (ordinal, None);
        }
        self.push(span.0, format_args!("{{__va({ordinal});"));
        (ordinal, Some(span.1))
    }

    fn close(&mut self, closer: Option<u32>) {
        if let Some(at) = closer {
            self.push(at, format_args!("}}"));
        }
    }

    /// A statement that becomes a region: entered, visited inside it, closed.
    fn region(&mut self, body: &Statement, kind: Kind, path: &str) {
        let span = body.span();
        let block = matches!(body, Statement::BlockStatement(_));
        let (ordinal, closer) = self.enter((span.start, span.end), block, kind, path);
        self.at(path, ordinal, |w| w.statement(body));
        self.close(closer);
    }

    fn branch(&mut self, it: &IfStatement) -> String {
        let label = self.step("if");
        self.visit_expression(&it.test);
        self.region(&it.consequent, Kind::Branch, &format!("{label}/then"));

        match &it.alternate {
            None => {
                let end = it.consequent.span().end;
                let owner = self.owner;
                let ordinal = self.open(Kind::Branch, &format!("{label}/else"), end, end, Some(owner));
                self.push(end, format_args!(" else{{__va({ordinal});}}"));
            }
            Some(alternate) => self.region(alternate, Kind::Branch, &format!("{label}/else")),
        }
        label
    }

    fn switched(&mut self, it: &SwitchStatement) -> String {
        let label = self.step("switch");
        let owner = self.owner;
        let path = self.path.clone();
        let mut written = false;

        self.visit_expression(&it.discriminant);

        for (index, clause) in it.cases.iter().enumerate() {
            let step = match clause.test {
                None => format!("{label}/default"),
                Some(_) => format!("{label}/case#{index}"),
            };
            written |= clause.test.is_none();

            let head = clause.consequent.first().map_or(clause.span.end, |s| s.span().start);
            let ordinal = self.open(Kind::Case, &step, head, clause.span.end, Some(owner));
            self.hit(head, ordinal);

            if let Some(test) = &clause.test {
                self.at(&path, owner, |w| w.visit_expression(test));
            }
            self.list(&clause.consequent, &step, ordinal);
        }

        if !written {
            let at = it.span.end - 1;
            let ordinal = self.open(Kind::Case, &format!("{label}/default"), at, at, Some(owner));
            self.push(at, format_args!("default:__va({ordinal});"));
        }
        label
    }

    fn guarded(&mut self, it: &TryStatement) -> String {
        let label = self.step("try");
        let owner = self.owner;

        self.list(&it.block.body, &format!("{label}/try"), owner);

        if let Some(handler) = &it.handler {
            if let Some(param) = &handler.param {
                self.visit_catch_parameter(param);
            }
            let path = format!("{label}/catch");
            let (caught, _) = self.enter((handler.body.span.start, handler.body.span.end), true, Kind::Handler, &path);
            self.list(&handler.body.body, &path, caught);
        }

        if let Some(finalizer) = &it.finalizer {
            let path = format!("{label}/finally");
            let (finished, _) = self.enter((finalizer.span.start, finalizer.span.end), true, Kind::Handler, &path);
            self.list(&finalizer.body, &path, finished);
        }
        label
    }

    /// `init`, `test`, `update`, `left`, `right`, in that order, then the body.
    fn looped(&mut self, statement: &Statement) -> String {
        let (word, body) = match statement {
            Statement::ForStatement(it) => ("for", &it.body),
            Statement::ForInStatement(it) => ("for", &it.body),
            Statement::ForOfStatement(it) => ("for", &it.body),
            Statement::WhileStatement(it) => ("while", &it.body),
            Statement::DoWhileStatement(it) => ("while", &it.body),
            _ => unreachable!("only loops reach here"),
        };
        let label = self.step(word);

        match statement {
            Statement::ForStatement(it) => {
                if let Some(init) = &it.init {
                    self.visit_for_statement_init(init);
                }
                if let Some(test) = &it.test {
                    self.visit_expression(test);
                }
                if let Some(update) = &it.update {
                    self.visit_expression(update);
                }
            }
            Statement::ForInStatement(it) => {
                self.visit_for_statement_left(&it.left);
                self.visit_expression(&it.right);
            }
            Statement::ForOfStatement(it) => {
                self.visit_for_statement_left(&it.left);
                self.visit_expression(&it.right);
            }
            Statement::WhileStatement(it) => self.visit_expression(&it.test),
            Statement::DoWhileStatement(it) => self.visit_expression(&it.test),
            _ => {}
        }

        self.region(body, Kind::Loop, &format!("{label}/body"));
        label
    }

    /// A function: a new name scope, a fresh path, and a region from its parameters to its end.
    ///
    /// A parameter is the function's, not the scope's that declares it: its
    /// default is evaluated on every call, and a parameter added to read in the
    /// body changes what the function does and nothing its declarer does. So the
    /// region opens before the parameters are walked, and a function in a default
    /// value is owned by the function whose parameter it is. The probe stands in
    /// the body, unless binding a parameter can throw: then it stands in front of
    /// that parameter, by the rewrite `instrument_params.rs` describes, because a
    /// call that throws while binding has arrived.
    fn entered(&mut self, own: Option<String>, params: &FormalParameters, body: Body, arrow: bool) {
        let hint = self.hint.take();
        self.named(own.or(hint));
        let owner = self.owner;

        let end = match body {
            // A TypeScript overload signature or an `abstract` method has no body at all.
            Body::None => None,
            Body::Block(body) => Some(body.span.end),
            Body::Expression(expression) => Some(expression.span().end),
        };
        let Some(end) = end else {
            self.at("", owner, |w| w.visit_formal_parameters(params));
            self.scopes.pop();
            return;
        };

        let entry = self.at("", owner, |w| w.open(Kind::Function, "entry", params.span.start, end, Some(owner)));
        let plan = params::plan(params, entry, arrow);
        self.at("", entry, |w| {
            for (at, text) in plan.iter().flat_map(|plan| &plan.before) {
                w.push(*at, format_args!("{text}"));
            }
            w.visit_formal_parameters(params);
            if let Some(plan) = &plan {
                w.push(plan.close, format_args!("}}"));
            }
            let body_probe = plan.is_none();
            match body {
                Body::None => {}
                Body::Block(body) => {
                    if body_probe {
                        w.hit(body.span.start + 1, entry);
                    }
                    w.list(&body.statements, "", entry);
                }
                Body::Expression(expression) if !body_probe => w.visit_expression(expression),
                Body::Expression(expression) => {
                    // `(n) => n * 2` becomes `(n) => (probe, n * 2)`.
                    let span = expression.span();
                    w.push(span.start, format_args!("(__va({entry}),"));
                    w.visit_expression(expression);
                    w.push(span.end, format_args!(")"));
                }
            }
        });

        self.scopes.pop();
    }

    /// `if#0`, `if#1`, `for#0` — numbered within the path that contains them.
    fn step(&mut self, kind: &str) -> String {
        let key = format!("{} {kind}", self.path);
        let scope = self.scopes.last_mut().expect("the module scope is never popped");
        let counter = scope.counts.entry(key).or_insert(0);
        let index = *counter;
        *counter += 1;
        if self.path.is_empty() {
            format!("{kind}#{index}")
        } else {
            format!("{}/{kind}#{index}", self.path)
        }
    }

    /// Push the scope a declaration opens: its own name, or the next `anon#i`.
    fn named(&mut self, own: Option<String>) {
        let outer = self.scope();
        let own = own.unwrap_or_else(|| {
            let at = outer.anon;
            outer.anon += 1;
            format!("anon#{at}")
        });
        let name = if outer.name.is_empty() { own } else { format!("{}/{own}", outer.name) };
        self.scopes.push(Scope::new(name));
    }

    /// Hand `name` to the child about to be visited, when that child can take one.
    fn hint_for(&mut self, child: &Expression, name: impl FnOnce(&mut Self) -> Option<String>) {
        if matches!(
            child,
            Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_) | Expression::ClassExpression(_)
        ) {
            self.hint = name(self);
        }
    }

    fn name_of(&mut self, expression: &Expression) -> Option<String> {
        match expression {
            Expression::Identifier(it) => Some(it.name.to_string()),
            Expression::StringLiteral(it) => Some(if it.lone_surrogates {
                spelled(&it.value)
            } else {
                it.value.to_string()
            }),
            Expression::NumericLiteral(it) => Some(it.value.to_js_string()),
            Expression::BigIntLiteral(it) => Some(it.value.to_string()),
            Expression::BooleanLiteral(it) => Some(it.value.to_string()),
            Expression::NullLiteral(_) => Some("null".to_string()),
            // `String(regex)`: the pattern as written and the flags in alphabetical
            // order, which is the order oxc prints them in.
            Expression::RegExpLiteral(it) => Some(it.regex.to_string()),
            Expression::StaticMemberExpression(it) => Some(it.property.name.to_string()),
            Expression::ComputedMemberExpression(it) => self.name_of(&it.expression),
            Expression::PrivateFieldExpression(it) => Some(it.field.name.to_string()),
            _ => None,
        }
    }

    fn name_of_key(&mut self, key: &PropertyKey) -> Option<String> {
        match key {
            PropertyKey::StaticIdentifier(it) => Some(it.name.to_string()),
            PropertyKey::PrivateIdentifier(it) => Some(it.name.to_string()),
            _ => self.name_of(key.to_expression()),
        }
    }

    fn name_of_target(&mut self, target: &AssignmentTarget) -> Option<String> {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(it) => Some(it.name.to_string()),
            AssignmentTarget::StaticMemberExpression(it) => Some(it.property.name.to_string()),
            AssignmentTarget::ComputedMemberExpression(it) => self.name_of(&it.expression),
            AssignmentTarget::PrivateFieldExpression(it) => Some(it.field.name.to_string()),
            _ => None,
        }
    }

    fn arguments(&mut self, callee: &Expression, arguments: &[Argument]) {
        self.visit_expression(callee);
        for (index, argument) in arguments.iter().enumerate() {
            if let Some(child) = argument.as_expression() {
                self.hint_for(child, |w| {
                    let callee = w.name_of(callee).unwrap_or_else(|| "call".to_string());
                    Some(format!("{callee}.arg{index}"))
                });
            }
            self.visit_argument(argument);
        }
    }
}

impl<'a> Visit<'a> for Walker {
    fn visit_statement(&mut self, it: &Statement<'a>) {
        self.statement(it);
    }

    fn visit_block_statement(&mut self, it: &BlockStatement<'a>) {
        let (path, owner) = (self.path.clone(), self.owner);
        self.list(&it.body, &path, owner);
    }

    fn visit_static_block(&mut self, it: &StaticBlock<'a>) {
        let (path, owner) = (self.path.clone(), self.owner);
        self.list(&it.body, &path, owner);
    }

    /// Execution came back: wrapped, so the awaited value survives.
    fn visit_await_expression(&mut self, it: &AwaitExpression<'a>) {
        if self.entries {
            return walk::walk_await_expression(self, it);
        }
        let label = self.step("await");
        let owner = self.owner;
        let ordinal = self.open(Kind::Resume, &label, it.span.start, it.span.end, Some(owner));
        self.push(it.span.start, format_args!("__vaR("));
        walk::walk_await_expression(self, it);
        self.push(it.span.end, format_args!(",{ordinal})"));
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        match it.r#type {
            FunctionType::FunctionDeclaration | FunctionType::FunctionExpression => {
                let own = it.id.as_ref().map(|id| id.name.to_string());
                let body = it.body.as_deref().map_or(Body::None, Body::Block);
                self.entered(own, &it.params, body, false);
            }
            // An overload signature or an `abstract` method opens nothing.
            _ => {
                self.hint = None;
                walk::walk_function(self, it, flags);
            }
        }
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let body = match &it.body {
            ArrowFunctionBody::FunctionBody(body) => Body::Block(body),
            expression => Body::Expression(expression.to_expression()),
        };
        self.entered(None, &it.params, body, true);
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let hint = self.hint.take();
        self.named(it.id.as_ref().map(|id| id.name.to_string()).or(hint));
        walk::walk_class(self, it);
        self.scopes.pop();
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        self.visit_binding_pattern(&it.id);
        if let Some(init) = &it.init {
            self.hint_for(init, |_| match &it.id {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                _ => None,
            });
            self.visit_expression(init);
        }
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        self.visit_property_key(&it.key);
        self.hint_for(&it.value, |w| w.name_of_key(&it.key));
        self.visit_expression(&it.value);
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.visit_decorators(&it.decorators);
        self.visit_property_key(&it.key);
        if let Some(value) = &it.value {
            if it.r#type == PropertyDefinitionType::PropertyDefinition {
                self.hint_for(value, |w| w.name_of_key(&it.key));
            }
            self.visit_expression(value);
        }
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        self.visit_decorators(&it.decorators);
        self.visit_property_key(&it.key);
        if it.r#type == MethodDefinitionType::MethodDefinition {
            self.hint = self.name_of_key(&it.key);
        }
        self.visit_function(&it.value, ScopeFlags::empty());
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        self.visit_assignment_target(&it.left);
        self.hint_for(&it.right, |w| w.name_of_target(&it.left));
        self.visit_expression(&it.right);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.arguments(&it.callee, &it.arguments);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        self.arguments(&it.callee, &it.arguments);
    }

    // Type positions hold no executable code, and walking them is pure cost.
    fn visit_ts_type_annotation(&mut self, _: &TSTypeAnnotation<'a>) {}
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
    fn visit_ts_type_parameter_declaration(&mut self, _: &TSTypeParameterDeclaration<'a>) {}
    fn visit_ts_type_parameter_instantiation(&mut self, _: &TSTypeParameterInstantiation<'a>) {}
    fn visit_ts_class_implements(&mut self, _: &TSClassImplements<'a>) {}
    fn visit_ts_type_alias_declaration(&mut self, _: &TSTypeAliasDeclaration<'a>) {}
    fn visit_ts_interface_declaration(&mut self, _: &TSInterfaceDeclaration<'a>) {}
    fn visit_ts_this_parameter(&mut self, _: &TSThisParameter<'a>) {}
}

/// A string holding a lone surrogate, with each one written `\uXXXX`.
///
/// No JavaScript string can come back from Rust holding a lone surrogate, so
/// `String(value)` cannot be matched and the name is spelled as it would be
/// escaped instead. oxc encodes a lone surrogate as U+FFFD followed by its code
/// unit in hex, and U+FFFD itself as U+FFFD followed by `fffd`.
fn spelled(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\u{FFFD}' {
            out.push(ch);
            continue;
        }
        let unit: String = chars.by_ref().take(4).collect();
        if unit == "fffd" {
            out.push('\u{FFFD}');
        } else {
            out.push_str("\\u");
            out.push_str(&unit.to_ascii_uppercase());
        }
    }
    out
}
