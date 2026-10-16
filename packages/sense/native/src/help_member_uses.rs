//! Where a member is used through a value whose type the source writes, and
//! which containers carry the members of another type.
//!
//! No type checker runs, so a member read is tied to a type only where the
//! source spells that type: the receiver is a binding whose annotation names it
//! (`props: Props`), an expression cast to it (`value as Props`), or `this`
//! inside a class, which is the class (an anonymous class: every type it
//! extends or implements), or inside a function whose `this` parameter names
//! one. An object literal
//! written as one (`const fixed: Props = { … }`, `{ … } satisfies Props`, the
//! value a function annotated `(): Props` returns) writes each of its keys, and
//! an annotated pattern (`({ size }: Props) =>`) destructures them. A React
//! component annotated with a component type `react` exports (`FC<Props>`,
//! `React.FunctionComponent<Props>`), or made by `memo` or `forwardRef` with a
//! props type argument (`memo<Props>(…)`, `forwardRef<Ref, Props>(…)`), takes
//! its first parameter as that type, as `@types/react` declares its call
//! signature. A class that extends `react`'s `Component<Props>` or
//! `PureComponent<Props>` holds `this.props` as `Props`. A JSX attribute writes
//! the member of the component the element names, `<Button size={1} />`, and an
//! indexed access type reads one, `Props['size']`. `Partial`, `Required` and
//! `Readonly` of a type are that type (`help_member_types.rs`). Each use records
//! the type's name as the file writes it; which declaration that name is,
//! through its import, is the query's join (`help_members.rs`), the same one
//! `uses` makes for an import.
//!
//! A carry says a container holds the members of a type the file writes:
//! `interface Wide extends Props`, `type Mixed = Props & { … }`, `class Box
//! implements Props`, a component whose first parameter is `Props`, whose JSX
//! attributes are its props' members, a class component of `Props`, and a
//! component `memo` or `forwardRef` makes of another. Over `Pick` the carry
//! keeps only the keys it names, and over `Omit` it drops them. The query walks
//! carries from the declaring type outwards, so a use written as `Wide`, `Box`
//! or `<Button>` counts for `Props`.
//!
//! A function carries its first parameter's type whether or not it is a
//! component, since which functions JSX renders is known only where they are
//! rendered. Carries share one name space for values and types, so a function
//! merged with a same-named interface (`function Config(o: Options)` beside
//! `interface Config`) makes a use written as `Config` count for `Options` as
//! well, and a class component's own `this.size` counts for its props.
//!
//! Bindings are scoped as oxc's walk enters and leaves scopes, so a parameter
//! that shadows an annotated one, `(props) => props.size`, is no use. What a
//! checker infers — a value returned by a call, a generic, a mapped type, a
//! value narrowed or aliased without an annotation — names no type here, and
//! is no use of any declaration.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::scope::{ScopeFlags, ScopeId};
use serde::Serialize;
use std::cell::Cell;

use crate::help_member_types::{Keys, Names};
use crate::read::Lines;

/// How a line uses a member.
pub(crate) const READ: &str = "read";
pub(crate) const WRITE: &str = "write";
pub(crate) const DESTRUCTURE: &str = "destructure";

/// One use of a member: its name, its line, the type its value is written
/// `of`, as the file names it, and `how` the line uses it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct MemberUse {
    pub(crate) name: String,
    pub(crate) line: u32,
    pub(crate) of: String,
    pub(crate) how: String,
}

/// A container `on`, declared in the file, that carries the members of the
/// type the file writes as `of`: those `only` names, when it names any, less
/// those in `except`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct Carry {
    pub(crate) on: String,
    pub(crate) of: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) only: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) except: Vec<String>,
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
        names: Names::of(program),
        scopes: vec![HashMap::new()],
        this: vec![This::default()],
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

/// What `this` is inside a function or a class: the types it is written as,
/// and the type a class component's `this.props` is.
#[derive(Default)]
struct This {
    types: Vec<String>,
    props: Option<String>,
}

struct Walker<'n> {
    lines: &'n Lines,
    names: Names,
    /// Each binding in scope and the type its annotation names, innermost last;
    /// `None` for a binding written without one.
    scopes: Vec<HashMap<String, Option<String>>>,
    /// What `this` is, innermost function or class last; empty where it is
    /// none the source writes.
    this: Vec<This>,
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

    fn carry(&mut self, on: &str, of: Option<(String, Keys)>) {
        let Some((of, keys)) = of.filter(|(_, keys)| !keys.none()) else { return };
        let carry = Carry { on: on.to_owned(), of, only: keys.only, except: keys.except };
        if self.carried.insert(carry.clone()) { self.carries.push(carry); }
    }

    /// The types a value is written as: a binding's annotation, the nearest
    /// scope that binds it deciding, a cast, `this`, or a class component's
    /// `this.props`.
    fn typed(&self, expression: &Expression) -> Vec<String> {
        match expression.without_parentheses() {
            Expression::Identifier(it) => self.scopes.iter().rev().find_map(|scope| scope.get(it.name.as_str())).cloned().flatten().into_iter().collect(),
            Expression::ThisExpression(_) => self.this.last().map(|this| this.types.clone()).unwrap_or_default(),
            Expression::StaticMemberExpression(it) if it.property.name == "props" && matches!(it.object.without_parentheses(), Expression::ThisExpression(_)) => {
                self.this.last().and_then(|this| this.props.clone()).into_iter().collect()
            }
            Expression::TSAsExpression(it) => self.names.named(&it.type_annotation).into_iter().collect(),
            Expression::TSSatisfiesExpression(it) => self.names.named(&it.type_annotation).into_iter().collect(),
            Expression::TSTypeAssertion(it) => self.names.named(&it.type_annotation).into_iter().collect(),
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
        if let Some(of) = self.names.annotated(it.type_annotation.as_deref()) { self.bind(&it.pattern, &of); }
        walk::walk_formal_parameter(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let annotation = it.type_annotation.as_deref().map(|it| &it.type_annotation);
        let props = annotation.and_then(|annotation| self.names.props(annotation));
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            let function = match init.without_parentheses() {
                Expression::ArrowFunctionExpression(function) => Some((Some(function.span.start), self.names.first_parameter(&function.params), props.clone())),
                Expression::FunctionExpression(function) => Some((Some(function.span.start), self.names.first_parameter(&function.params), props.clone())),
                other => self.names.wrapped(other).map(|wrapped| (wrapped.function, wrapped.carries, wrapped.props.or_else(|| props.clone()))),
            };
            if let Some((start, written, props)) = function {
                if let (Some(start), Some(of)) = (start, &props) { self.pending = Some((start, of.clone())); }
                self.carry(&id.name, written.or(props).map(|of| (of, Keys::default())));
            }
        }
        let of = annotation.and_then(|annotation| self.names.named(annotation));
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
        if let Some(id) = &it.id {
            let of = self.names.first_parameter(&it.params).map(|of| (of, Keys::default()));
            self.carry(&id.name, of);
        }
        let method = std::mem::take(&mut self.method);
        if !method {
            let this = it.this_param.as_ref().and_then(|this| self.names.annotated(this.type_annotation.as_deref()));
            self.this.push(This { types: this.into_iter().collect(), props: None });
        }
        self.props = self.props_for(it.span.start);
        self.returns.push(self.names.annotated(it.return_type.as_deref()));
        walk::walk_function(self, it, flags);
        self.returns.pop();
        if !method { self.this.pop(); }
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let returns = self.names.annotated(it.return_type.as_deref());
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
        let mut carried: Vec<(String, Keys)> = Vec::new();
        let base = it.heritage.as_ref();
        let props = base.and_then(|base| self.names.class_props(base));
        if let Some(Expression::Identifier(base)) = base.map(|base| base.expression.without_parentheses()) { carried.push((base.name.to_string(), Keys::default())); }
        carried.extend(props.clone());
        carried.extend(it.implements.iter().filter_map(|one| self.names.reference(&one.expression, one.type_arguments.as_deref())));
        // A named class is `this`, and its carries reach what it extends or
        // implements, and a class component's props; an anonymous one has no
        // name to carry from, so `this` is those types themselves.
        let types = match &it.id {
            Some(id) => {
                for of in &carried { self.carry(&id.name, Some(of.clone())); }
                vec![id.name.to_string()]
            }
            None => carried.into_iter().map(|(of, _)| of).collect(),
        };
        self.this.push(This { types, props: props.map(|(of, _)| of) });
        walk::walk_class(self, it);
        self.this.pop();
    }

    fn visit_ts_interface_declaration(&mut self, it: &TSInterfaceDeclaration<'a>) {
        for heritage in &it.extends {
            let of = self.names.reference(&heritage.type_name, heritage.type_arguments.as_deref());
            self.carry(&it.id.name, of);
        }
        walk::walk_ts_interface_declaration(self, it);
    }

    fn visit_ts_type_alias_declaration(&mut self, it: &TSTypeAliasDeclaration<'a>) {
        match &it.type_annotation {
            TSType::TSIntersectionType(both) => {
                for one in &both.types {
                    let of = self.names.carried(one);
                    self.carry(&it.id.name, of);
                }
            }
            other => {
                let of = self.names.carried(other);
                self.carry(&it.id.name, of);
            }
        }
        walk::walk_ts_type_alias_declaration(self, it);
    }

    fn visit_ts_indexed_access_type(&mut self, it: &TSIndexedAccessType<'a>) {
        if let (Some(of), TSType::TSLiteralType(index)) = (self.names.named(&it.object_type), &it.index_type) {
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
        if let Some(of) = self.names.named(&it.type_annotation) { self.literal(&it.expression, &of); }
        walk::walk_ts_as_expression(self, it);
    }

    fn visit_ts_satisfies_expression(&mut self, it: &TSSatisfiesExpression<'a>) {
        if let Some(of) = self.names.named(&it.type_annotation) { self.literal(&it.expression, &of); }
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
