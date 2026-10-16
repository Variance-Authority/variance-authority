//! What a type the source writes names, for `help_member_uses.rs`: a plain
//! reference, one of TypeScript's utility types over one, and the component
//! types, wrappers and base classes `react` exports.
//!
//! `Partial`, `Required` and `Readonly` of a type hold its members; `Pick`
//! keeps the keys it names and `Omit` drops them, when the keys are string
//! literals. They are TypeScript's globals, so a file that declares or imports
//! one of those names writes its own type, and nothing is unwrapped. A React
//! name counts only as the file imports it from `react`, by name (renamed or
//! not) or off a default or namespace import (`React.FC`, `React.memo`,
//! `React.Component`).

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use oxc_ast::ast::*;

/// The component types `react` exports whose call signature is `(props: P)`.
const COMPONENT_TYPES: [&str; 4] = ["FC", "FunctionComponent", "VFC", "VoidFunctionComponent"];
/// The component classes `react` exports, whose first type argument is `this.props`.
const COMPONENT_CLASSES: [&str; 2] = ["Component", "PureComponent"];
/// TypeScript's utility types that hold every member of the type they take.
const WHOLE: [&str; 3] = ["Partial", "Required", "Readonly"];

/// Which members of a type a carry holds: those `only` names, when it names
/// any, or every one but those in `except`. Never both.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub(crate) struct Keys {
    pub(crate) only: Option<Vec<String>>,
    pub(crate) except: Vec<String>,
}

impl Keys {
    /// Whether the keys hold no member at all, which carries nothing.
    pub(crate) fn none(&self) -> bool {
        self.only.as_ref().is_some_and(Vec::is_empty)
    }
}

/// A component a call to `memo` or `forwardRef` makes: the function it wraps,
/// by where it starts, the props type its type argument names, and what the
/// component carries — that type, the wrapped function's first parameter's,
/// or the name of a component it wraps.
pub(crate) struct Wrapped {
    pub(crate) function: Option<u32>,
    pub(crate) props: Option<String>,
    pub(crate) carries: Option<String>,
}

#[derive(Clone, Copy)]
enum Wrapper {
    Memo,
    ForwardRef,
}

/// The names this file gives `react`'s exports and TypeScript's utility types.
#[derive(Default)]
pub(crate) struct Names {
    components: HashSet<String>,
    classes: HashSet<String>,
    memo: HashSet<String>,
    forward_ref: HashSet<String>,
    modules: HashSet<String>,
    /// The names the file declares or imports at its top level.
    own: HashSet<String>,
}

impl Names {
    pub(crate) fn of(program: &Program) -> Names {
        let mut names = Names::default();
        for statement in &program.body {
            if let Some(declared) = declared(statement) { names.own.insert(declared); }
            let Statement::ImportDeclaration(import) = statement else { continue };
            for specifier in import.specifiers.iter().flatten() {
                names.own.insert(specifier.local().name.to_string());
            }
            if import.source.value != "react" { continue; }
            for specifier in import.specifiers.iter().flatten() {
                let local = specifier.local().name.to_string();
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(it) => match it.imported.name().as_str() {
                        name if COMPONENT_TYPES.contains(&name) => { names.components.insert(local); }
                        name if COMPONENT_CLASSES.contains(&name) => { names.classes.insert(local); }
                        "memo" => { names.memo.insert(local); }
                        "forwardRef" => { names.forward_ref.insert(local); }
                        _ => {}
                    },
                    _ => { names.modules.insert(local); }
                }
            }
        }
        names
    }

    /// The type `annotation` names, through a utility type over it, alone or
    /// in a union with `undefined` or `null`. A use through it is of that
    /// type: a key `Pick` or `Omit` leaves out is not there to use.
    pub(crate) fn named(&self, annotation: &TSType) -> Option<String> {
        self.carried(annotation).map(|(name, _)| name)
    }

    pub(crate) fn annotated(&self, annotation: Option<&TSTypeAnnotation>) -> Option<String> {
        annotation.and_then(|it| self.named(&it.type_annotation))
    }

    /// The type the first parameter of `params` is annotated with.
    pub(crate) fn first_parameter(&self, params: &FormalParameters) -> Option<String> {
        params.items.first().and_then(|first| self.annotated(first.type_annotation.as_deref()))
    }

    /// The type `annotation` names and the keys of it that it holds.
    pub(crate) fn carried(&self, annotation: &TSType) -> Option<(String, Keys)> {
        match annotation {
            TSType::TSTypeReference(it) => self.reference(&it.type_name, it.type_arguments.as_deref()),
            TSType::TSParenthesizedType(it) => self.carried(&it.type_annotation),
            TSType::TSUnionType(it) => {
                let mut left = it.types.iter().filter(|one| !matches!(one, TSType::TSUndefinedKeyword(_) | TSType::TSNullKeyword(_)));
                match (left.next(), left.next()) {
                    (Some(one), None) => self.carried(one),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// A reference by a plain name with its type arguments, as an annotation,
    /// a heritage clause or an `implements` writes one.
    pub(crate) fn reference(&self, name: &TSTypeName, arguments: Option<&TSTypeParameterInstantiation>) -> Option<(String, Keys)> {
        let name = plain(name)?;
        let argument = |at: usize| arguments.and_then(|it| it.params.get(at));
        if self.own.contains(&name) { return Some((name, Keys::default())); }
        if WHOLE.contains(&name.as_str()) { return self.carried(argument(0)?); }
        let picked = match name.as_str() {
            "Pick" => true,
            "Omit" => false,
            _ => return Some((name, Keys::default())),
        };
        let (of, mut keys) = self.carried(argument(0)?)?;
        let named = literal_keys(argument(1)?)?;
        // Keys keep a list or drop one, never both: each narrows a list kept before it.
        let kept = match (picked, keys.only.take()) {
            (true, Some(only)) => Some(only.into_iter().filter(|key| named.contains(key)).collect()),
            (true, None) => Some(named.into_iter().filter(|key| !keys.except.contains(key)).collect()),
            (false, Some(only)) => Some(only.into_iter().filter(|key| !named.contains(key)).collect()),
            (false, None) => {
                keys.except.extend(named);
                None
            }
        };
        if kept.is_some() { keys.except.clear(); }
        keys.only = kept;
        Some((of, keys))
    }

    /// The props type of a component type `annotation` writes: `FC<Props>`
    /// under the name the file imports it as, or `React.FC<Props>`.
    pub(crate) fn props(&self, annotation: &TSType) -> Option<String> {
        let TSType::TSTypeReference(it) = annotation else { return None };
        let component = match &it.type_name {
            TSTypeName::IdentifierReference(name) => self.components.contains(name.name.as_str()),
            TSTypeName::QualifiedName(name) => self.module(&name.left) && COMPONENT_TYPES.contains(&name.right.name.as_str()),
            _ => false,
        };
        if !component { return None; }
        it.type_arguments.as_ref().and_then(|arguments| arguments.params.first()).and_then(|it| self.named(it))
    }

    /// The props type a class whose base is `heritage` takes, when the base is
    /// `react`'s `Component` or `PureComponent`.
    pub(crate) fn class_props(&self, heritage: &ClassHeritage) -> Option<(String, Keys)> {
        let component = match heritage.expression.without_parentheses() {
            Expression::Identifier(it) => self.classes.contains(it.name.as_str()),
            Expression::StaticMemberExpression(it) => {
                matches!(&it.object, Expression::Identifier(module) if self.modules.contains(module.name.as_str()))
                    && COMPONENT_CLASSES.contains(&it.property.name.as_str())
            }
            _ => false,
        };
        if !component { return None; }
        heritage.type_arguments.as_ref().and_then(|arguments| arguments.params.first()).and_then(|it| self.carried(it))
    }

    /// The component a call to `memo` or `forwardRef` makes, a wrapper inside
    /// a wrapper read through.
    pub(crate) fn wrapped(&self, expression: &Expression) -> Option<Wrapped> {
        let Expression::CallExpression(call) = expression.without_parentheses() else { return None };
        let wrapper = self.wrapper(&call.callee)?;
        let argument = |at: usize| call.type_arguments.as_ref().and_then(|it| it.params.get(at)).and_then(|it| self.named(it));
        let mut props = match wrapper {
            Wrapper::Memo => argument(0),
            Wrapper::ForwardRef => argument(1),
        };
        let inner = call.arguments.first().and_then(Argument::as_expression).map(Expression::without_parentheses);
        let (function, written) = match inner {
            Some(Expression::ArrowFunctionExpression(it)) => (Some(it.span.start), self.first_parameter(&it.params)),
            Some(Expression::FunctionExpression(it)) => (Some(it.span.start), self.first_parameter(&it.params)),
            Some(Expression::Identifier(it)) => (None, Some(it.name.to_string())),
            Some(other) => match self.wrapped(other) {
                Some(inner) => {
                    props = props.or(inner.props);
                    (inner.function, inner.carries)
                }
                None => (None, None),
            },
            None => (None, None),
        };
        Some(Wrapped { function, carries: written.or_else(|| props.clone()), props })
    }

    fn wrapper(&self, callee: &Expression) -> Option<Wrapper> {
        let (name, by_module) = match callee.without_parentheses() {
            Expression::Identifier(it) => (it.name.as_str(), false),
            Expression::StaticMemberExpression(it) => {
                let Expression::Identifier(module) = &it.object else { return None };
                if !self.modules.contains(module.name.as_str()) { return None; }
                (it.property.name.as_str(), true)
            }
            _ => return None,
        };
        match (by_module, name) {
            (true, "memo") => Some(Wrapper::Memo),
            (true, "forwardRef") => Some(Wrapper::ForwardRef),
            (false, local) if self.memo.contains(local) => Some(Wrapper::Memo),
            (false, local) if self.forward_ref.contains(local) => Some(Wrapper::ForwardRef),
            _ => None,
        }
    }

    fn module(&self, name: &TSTypeName) -> bool {
        matches!(name, TSTypeName::IdentifierReference(left) if self.modules.contains(left.name.as_str()))
    }
}

pub(crate) fn plain(name: &TSTypeName) -> Option<String> {
    match name {
        TSTypeName::IdentifierReference(name) => Some(name.name.to_string()),
        _ => None,
    }
}

/// The keys a `Pick` or `Omit` names: a string literal, or a union of them.
fn literal_keys(keys: &TSType) -> Option<Vec<String>> {
    let one = |key: &TSType| match key {
        TSType::TSLiteralType(it) => match &it.literal {
            TSLiteral::StringLiteral(name) => Some(name.value.to_string()),
            _ => None,
        },
        _ => None,
    };
    match keys {
        TSType::TSUnionType(it) => it.types.iter().map(one).collect(),
        other => one(other).map(|key| vec![key]),
    }
}

/// The type or value name a top-level statement declares.
fn declared(statement: &Statement) -> Option<String> {
    let declaration = match statement {
        Statement::ExportDeclaration(it) => &it.declaration,
        other => other.as_declaration()?,
    };
    match declaration {
        Declaration::TSTypeAliasDeclaration(it) => Some(it.id.name.to_string()),
        Declaration::TSInterfaceDeclaration(it) => Some(it.id.name.to_string()),
        Declaration::ClassDeclaration(it) => it.id.as_ref().map(|id| id.name.to_string()),
        _ => None,
    }
}
