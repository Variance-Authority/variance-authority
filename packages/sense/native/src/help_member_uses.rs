//! Where a member is used through a value whose type the source writes, and
//! which containers carry the members of another type.
//!
//! No type checker runs, so a member read is tied to a type only where the
//! source spells that type: the receiver is a binding whose annotation names it
//! (`props: Props`), an expression cast to it (`value as Props`), or `this`
//! inside a class, which is the class and every type it extends or implements,
//! or inside a function whose `this` parameter names one. An object literal
//! written as one (`const fixed: Props = { … }`, `{ … } satisfies Props`, the
//! value a function annotated `(): Props` returns) writes each of its keys, and
//! an annotated pattern (`({ size }: Props) =>`) destructures them. A React
//! component annotated with a component type `react` exports (`FC<Props>`,
//! `React.FunctionComponent<Props>`) takes its first parameter as that type, as
//! `@types/react` declares its call signature. A JSX attribute writes the member
//! of the component the element names, `<Button size={1} />`, and an indexed
//! access type reads one, `Props['size']`. Each use records the type's name as
//! the file writes it; which declaration that name is, through its import, is
//! the query's join (`help_members.rs`), the same one `uses` makes for an import.
//!
//! A carry says a container holds every member of a type the file writes:
//! `interface Wide extends Props`, `type Mixed = Props & { … }`, `class Box
//! implements Props`, and a component whose first parameter is `Props`, whose
//! JSX attributes are its props' members. The query walks carries from the
//! declaring type outwards, so a use written as `Wide`, `Box` or `<Button>`
//! counts for `Props`.
//!
//! Bindings are scoped as oxc's walk enters and leaves scopes, so a parameter
//! that shadows an annotated one, `(props) => props.size`, is no use. What a
//! checker infers — a value returned by a call, a generic, a mapped or utility
//! type, a component wrapped in `memo` or `forwardRef`, a value narrowed or
//! aliased without an annotation — names no type here, and is no use of any
//! declaration.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::scope::{ScopeFlags, ScopeId};
use serde::Serialize;
use std::cell::Cell;

use crate::read::Lines;

/// How a line uses a member.
pub(crate) const READ: &str = "read";
pub(crate) const WRITE: &str = "write";
pub(crate) const DESTRUCTURE: &str = "destructure";

/// The component types `react` exports whose call signature is `(props: P)`.
const COMPONENT_TYPES: [&str; 4] = ["FC", "FunctionComponent", "VFC", "VoidFunctionComponent"];

/// One use of a member: its name, its line, the type its value is written
/// `of`, as the file names it, and `how` the line uses it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct MemberUse {
    pub(crate) name: String,
    pub(crate) line: u32,
    pub(crate) of: String,
    pub(crate) how: String,
}

/// A container `on`, declared in the file, that carries every member of the
/// type the file writes as `of`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct Carry {
    pub(crate) on: String,
    pub(crate) of: String,
}

/// What one walk of a file reads: its member uses and its carries.
pub(crate) struct Typed {
    pub(crate) uses: Vec<MemberUse>,
    pub(crate) carries: Vec<Carry>,
}

/// Every use `program` writes of a member through a value whose type it
/// names, once per name, line, type and kind, in source order, and every
/// carry it declares, once each, in source order.
pub(crate) fn typed_in(program: &Program<'_>, lines: &Lines) -> Typed {
    let mut walker = Walker {
        lines,
        react: React::of(program),
        scopes: vec![HashMap::new()],
        this: vec![Vec::new()],
        returns: Vec::new(),
        method: false,
        props: None,
        pending: None,
        written: HashSet::new(),
        seen: HashSet::new(),
        found: Vec::new(),
        carried: HashSet::new(),
        carries: Vec::new(),
    };
    walker.visit_program(program);
    Typed { uses: walker.found, carries: walker.carries }
}

/// The name of the one type `annotation` writes: a reference by a plain name,
/// with or without type arguments, alone or in a union with `undefined` or
/// `null`.
fn named(annotation: &TSType) -> Option<String> {
    match annotation {
        TSType::TSTypeReference(it) => plain(&it.type_name),
        TSType::TSParenthesizedType(it) => named(&it.type_annotation),
        TSType::TSUnionType(it) => {
            let mut left = it.types.iter().filter(|one| !matches!(one, TSType::TSUndefinedKeyword(_) | TSType::TSNullKeyword(_)));
            match (left.next(), left.next()) {
                (Some(one), None) => named(one),
                _ => None,
            }
        }
        _ => None,
    }
}

fn plain(name: &TSTypeName) -> Option<String> {
    match name {
        TSTypeName::IdentifierReference(name) => Some(name.name.to_string()),
        _ => None,
    }
}

fn annotated(annotation: Option<&TSTypeAnnotation>) -> Option<String> {
    annotation.and_then(|it| named(&it.type_annotation))
}

/// The type the first parameter of `params` is annotated with.
fn first_parameter(params: &FormalParameters) -> Option<String> {
    params.items.first().and_then(|first| annotated(first.type_annotation.as_deref()))
}

/// The names this file gives `react`'s component types and the module itself.
#[derive(Default)]
struct React {
    components: HashSet<String>,
    modules: HashSet<String>,
}

impl React {
    fn of(program: &Program) -> React {
        let mut react = React::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            if import.source.value != "react" { continue; }
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(it) => {
                        if COMPONENT_TYPES.contains(&it.imported.name().as_str()) { react.components.insert(it.local.name.to_string()); }
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(it) => { react.modules.insert(it.local.name.to_string()); }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(it) => { react.modules.insert(it.local.name.to_string()); }
                }
            }
        }
        react
    }

    /// The props type of a component type `annotation` writes: `FC<Props>`
    /// under the name the file imports it as, or `React.FC<Props>`.
    fn props(&self, annotation: &TSType) -> Option<String> {
        let TSType::TSTypeReference(it) = annotation else { return None };
        let component = match &it.type_name {
            TSTypeName::IdentifierReference(name) => self.components.contains(name.name.as_str()),
            TSTypeName::QualifiedName(name) => {
                matches!(&name.left, TSTypeName::IdentifierReference(left) if self.modules.contains(left.name.as_str()))
                    && COMPONENT_TYPES.contains(&name.right.name.as_str())
            }
            _ => false,
        };
        if !component { return None; }
        it.type_arguments.as_ref().and_then(|arguments| arguments.params.first()).and_then(named)
    }
}

struct Walker<'n> {
    lines: &'n Lines,
    react: React,
    /// Each binding in scope and the type its annotation names, innermost last;
    /// `None` for a binding written without one.
    scopes: Vec<HashMap<String, Option<String>>>,
    /// The types `this` is, innermost function or class last; empty where it is
    /// none the source writes.
    this: Vec<Vec<String>>,
    /// The return type of each function the walk is inside, innermost last.
    returns: Vec<Option<String>>,
    /// The function visited next is a class method's, which keeps `this`.
    method: bool,
    /// The type the parameters visited next take their first one as.
    props: Option<String>,
    /// A component's function, by where it starts, and the type it takes its first parameter as.
    pending: Option<(u32, String)>,
    /// The member expressions an assignment or an update writes, by span.
    written: HashSet<(u32, u32)>,
    seen: HashSet<MemberUse>,
    found: Vec<MemberUse>,
    carried: HashSet<Carry>,
    carries: Vec<Carry>,
}

impl Walker<'_> {
    fn add(&mut self, name: &str, at: u32, of: &str, how: &str) {
        let found = MemberUse { name: name.to_owned(), line: self.lines.at(at), of: of.to_owned(), how: how.to_owned() };
        if self.seen.insert(found.clone()) { self.found.push(found); }
    }

    fn carry(&mut self, on: &str, of: Option<String>) {
        let Some(of) = of else { return };
        let carry = Carry { on: on.to_owned(), of };
        if self.carried.insert(carry.clone()) { self.carries.push(carry); }
    }

    /// The types a value is written as: a binding's annotation, the nearest
    /// scope that binds it deciding, a cast, or `this`.
    fn typed(&self, expression: &Expression) -> Vec<String> {
        match expression.without_parentheses() {
            Expression::Identifier(it) => self.scopes.iter().rev().find_map(|scope| scope.get(it.name.as_str())).cloned().flatten().into_iter().collect(),
            Expression::ThisExpression(_) => self.this.last().cloned().unwrap_or_default(),
            Expression::TSAsExpression(it) => named(&it.type_annotation).into_iter().collect(),
            Expression::TSSatisfiesExpression(it) => named(&it.type_annotation).into_iter().collect(),
            Expression::TSTypeAssertion(it) => named(&it.type_annotation).into_iter().collect(),
            Expression::TSNonNullExpression(it) => self.typed(&it.expression),
            _ => Vec::new(),
        }
    }

    /// A pattern bound to a value of type `of`: a name holds it, an object
    /// pattern destructures each key it names.
    fn bind(&mut self, pattern: &BindingPattern, of: &str) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => {
                if let Some(scope) = self.scopes.last_mut() { scope.insert(it.name.to_string(), Some(of.to_owned())); }
            }
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    if let Some(name) = property.key.static_name() { self.add(&name, property.key.span().start, of, DESTRUCTURE); }
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, of),
            BindingPattern::ArrayPattern(_) => {}
        }
    }

    /// An object literal written as a value of type `of` writes each key it names.
    fn literal(&mut self, expression: &Expression, of: &str) {
        let Expression::ObjectExpression(object) = expression.without_parentheses() else { return };
        for property in &object.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property {
                if let Some(name) = property.key.static_name() { self.add(&name, property.key.span().start, of, WRITE); }
            }
        }
    }

    fn member(&mut self, object: &Expression, name: &str, at: u32, span: (u32, u32)) {
        let how = if self.written.contains(&span) { WRITE } else { READ };
        for of in self.typed(object) { self.add(name, at, &of, how); }
    }

    fn writes(&mut self, target: Option<&MemberExpression>) {
        if let Some(target) = target { self.written.insert((target.span().start, target.span().end)); }
    }

    /// The type a component's function at `start` takes its first parameter as, once.
    fn props_for(&mut self, start: u32) -> Option<String> {
        match self.pending.take() {
            Some((at, of)) if at == start => Some(of),
            other => { self.pending = other; None }
        }
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn enter_scope(&mut self, _flags: ScopeFlags, _scope_id: &Cell<Option<ScopeId>>) {
        self.scopes.push(HashMap::new());
    }

    fn leave_scope(&mut self) {
        self.scopes.pop();
    }

    // Every binding shadows the outer one of its name; one an annotation
    // already typed in this scope keeps its type.
    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        if let Some(scope) = self.scopes.last_mut() { scope.entry(it.name.to_string()).or_insert(None); }
    }

    fn visit_formal_parameters(&mut self, it: &FormalParameters<'a>) {
        if let Some(of) = self.props.take() {
            if let Some(first) = it.items.first().filter(|first| first.type_annotation.is_none()) { self.bind(&first.pattern, &of); }
        }
        walk::walk_formal_parameters(self, it);
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let Some(of) = annotated(it.type_annotation.as_deref()) { self.bind(&it.pattern, &of); }
        walk::walk_formal_parameter(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let annotation = it.type_annotation.as_deref().map(|it| &it.type_annotation);
        let props = annotation.and_then(|annotation| self.react.props(annotation));
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            let function = match init.without_parentheses() {
                Expression::ArrowFunctionExpression(function) => Some((function.span.start, first_parameter(&function.params))),
                Expression::FunctionExpression(function) => Some((function.span.start, first_parameter(&function.params))),
                _ => None,
            };
            if let Some((start, written)) = function {
                if let Some(of) = &props { self.pending = Some((start, of.clone())); }
                self.carry(&id.name, written.or_else(|| props.clone()));
            }
        }
        let of = annotation.and_then(named);
        if let Some(of) = of {
            if let Some(init) = &it.init { self.literal(init, &of); }
            self.bind(&it.id, &of);
        } else if let (BindingPattern::ObjectPattern(_), Some(init)) = (&it.id, &it.init) {
            // `const { size } = props` destructures what `props` is written as.
            for of in self.typed(init) { self.bind(&it.id, &of); }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if let Some(id) = &it.id { self.carry(&id.name, first_parameter(&it.params)); }
        let method = std::mem::take(&mut self.method);
        if !method {
            let this = it.this_param.as_ref().and_then(|this| annotated(this.type_annotation.as_deref()));
            self.this.push(this.into_iter().collect());
        }
        self.props = self.props_for(it.span.start);
        self.returns.push(annotated(it.return_type.as_deref()));
        walk::walk_function(self, it, flags);
        self.returns.pop();
        if !method { self.this.pop(); }
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let returns = annotated(it.return_type.as_deref());
        if let (Some(of), Some(body)) = (&returns, it.get_expression()) { self.literal(body, of); }
        self.props = self.props_for(it.span.start);
        self.returns.push(returns);
        walk::walk_arrow_function_expression(self, it);
        self.returns.pop();
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        if let (Some(Some(of)), Some(argument)) = (self.returns.last().cloned(), &it.argument) { self.literal(argument, &of); }
        walk::walk_return_statement(self, it);
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        self.method = true;
        walk::walk_method_definition(self, it);
        self.method = false;
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let mut carried: Vec<String> = Vec::new();
        if let Some(Expression::Identifier(base)) = it.heritage.as_ref().map(|base| base.expression.without_parentheses()) { carried.push(base.name.to_string()); }
        carried.extend(it.implements.iter().filter_map(|one| plain(&one.expression)));
        if let Some(id) = &it.id {
            for of in &carried { self.carry(&id.name, Some(of.clone())); }
        }
        self.this.push(it.id.iter().map(|id| id.name.to_string()).chain(carried).collect());
        walk::walk_class(self, it);
        self.this.pop();
    }

    fn visit_ts_interface_declaration(&mut self, it: &TSInterfaceDeclaration<'a>) {
        for heritage in &it.extends { self.carry(&it.id.name, plain(&heritage.type_name)); }
        walk::walk_ts_interface_declaration(self, it);
    }

    fn visit_ts_type_alias_declaration(&mut self, it: &TSTypeAliasDeclaration<'a>) {
        match &it.type_annotation {
            TSType::TSIntersectionType(both) => {
                for one in &both.types { self.carry(&it.id.name, named(one)); }
            }
            other => self.carry(&it.id.name, named(other)),
        }
        walk::walk_ts_type_alias_declaration(self, it);
    }

    fn visit_ts_indexed_access_type(&mut self, it: &TSIndexedAccessType<'a>) {
        if let (Some(of), TSType::TSLiteralType(index)) = (named(&it.object_type), &it.index_type) {
            if let TSLiteral::StringLiteral(name) = &index.literal { self.add(&name.value, name.span.start, &of, READ); }
        }
        walk::walk_ts_indexed_access_type(self, it);
    }

    fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'a>) {
        if let JSXElementName::IdentifierReference(component) = &it.name {
            for attribute in &it.attributes {
                if let JSXAttributeItem::Attribute(attribute) = attribute {
                    if let JSXAttributeName::Identifier(name) = &attribute.name { self.add(&name.name, name.span.start, &component.name, WRITE); }
                }
            }
        }
        walk::walk_jsx_opening_element(self, it);
    }

    fn visit_ts_as_expression(&mut self, it: &TSAsExpression<'a>) {
        if let Some(of) = named(&it.type_annotation) { self.literal(&it.expression, &of); }
        walk::walk_ts_as_expression(self, it);
    }

    fn visit_ts_satisfies_expression(&mut self, it: &TSSatisfiesExpression<'a>) {
        if let Some(of) = named(&it.type_annotation) { self.literal(&it.expression, &of); }
        walk::walk_ts_satisfies_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        self.writes(it.left.as_member_expression());
        walk::walk_assignment_expression(self, it);
    }

    fn visit_update_expression(&mut self, it: &UpdateExpression<'a>) {
        self.writes(it.argument.as_member_expression());
        walk::walk_update_expression(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        self.member(&it.object, &it.property.name, it.property.span.start, (it.span.start, it.span.end));
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        if let Expression::StringLiteral(name) = &it.expression {
            self.member(&it.object, &name.value, name.span.start, (it.span.start, it.span.end));
        }
        walk::walk_computed_member_expression(self, it);
    }
}

#[cfg(test)]
#[path = "help_member_uses_tests.rs"]
mod tests;
