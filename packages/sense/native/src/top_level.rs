//! The names a module's own statements bind, walked once for every reader of them.
//!
//! `Harvest` keeps them as the symbols an orientation reads, `DeclaredRoles` as
//! the names a doc's role tag covers, and `declarations` as the components a
//! module declares. Each filters this one walk over `program.body`, so no two
//! readers disagree about which statement binds which name; they differ only in
//! which names they keep.

use oxc_ast::ast::{
    Declaration, ExportDefaultDeclarationKind, Expression, Program, Statement,
    VariableDeclaration, VariableDeclarationKind, VariableDeclarator,
};
use oxc_span::{GetSpan, Span};

/// One name a top-level statement binds.
#[derive(Clone, Copy)]
pub(crate) struct TopLevel<'a> {
    /// The name, or `default` for the one an `export default` statement gives.
    pub(crate) name: &'a str,
    /// `function`, `class`, the variable keyword, `type`, `interface`, `enum`,
    /// `namespace`, `import` for `import x = require()`, and for a default
    /// export of an expression `object` or `const`.
    pub(crate) kind: &'static str,
    /// The statement that binds it, where its line and its doc are read.
    pub(crate) statement: Span,
    /// The declaration up to its body.
    pub(crate) signature: Option<Span>,
    /// Written with TypeScript's `declare`: the name is bound somewhere else.
    pub(crate) declare: bool,
    /// Bound by an `export` or `export default` statement.
    pub(crate) exported: bool,
    /// The `default` an `export default` statement gives, which no code spells.
    pub(crate) default: bool,
    /// Taken out of a destructuring pattern rather than bound whole.
    pub(crate) destructured: bool,
}

/// Every name `program`'s own statements bind, in source order.
pub(crate) fn top_level<'a>(program: &Program<'a>, mut visit: impl FnMut(TopLevel<'a>)) {
    for statement in &program.body {
        let span = statement.span();
        match statement {
            Statement::ExportDeclaration(exported) => declaration(&exported.declaration, span, true, &mut visit),
            Statement::ExportDefaultDeclaration(exported) => default_export(&exported.declaration, span, &mut visit),
            _ => {
                if let Some(declared) = statement.as_declaration() {
                    declaration(declared, span, false, &mut visit);
                }
            }
        }
    }
}

fn declaration<'a>(declared: &Declaration<'a>, statement: Span, exported: bool, visit: &mut impl FnMut(TopLevel<'a>)) {
    let declare = declared.declare();
    let mut bind = |name: &oxc_ast::ast::BindingIdentifier<'a>, kind: &'static str, signature: Span| {
        visit(TopLevel {
            name: name.name.as_str(),
            kind,
            statement,
            signature: Some(signature),
            declare,
            exported,
            default: false,
            destructured: false,
        });
    };
    match declared {
        Declaration::VariableDeclaration(variables) => bindings(variables, statement, exported, visit),
        Declaration::FunctionDeclaration(function) => {
            if let Some(id) = &function.id {
                let end = function.body.as_ref().map_or(function.span.end, |body| body.span.start);
                bind(id, "function", Span::new(function.span.start, end));
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(id) = &class.id {
                bind(id, "class", Span::new(class.span.start, class.body.span.start));
            }
        }
        Declaration::TSTypeAliasDeclaration(alias) => bind(&alias.id, "type", alias.span),
        Declaration::TSInterfaceDeclaration(interface) => {
            bind(&interface.id, "interface", Span::new(interface.span.start, interface.body.span.start))
        }
        Declaration::TSEnumDeclaration(enumeration) => {
            bind(&enumeration.id, "enum", Span::new(enumeration.span.start, enumeration.body.span.start))
        }
        Declaration::TSNamespaceDeclaration(namespace) => {
            bind(&namespace.id, "namespace", Span::new(namespace.span.start, namespace.body.span().start))
        }
        Declaration::TSImportEqualsDeclaration(imported) => bind(&imported.id, "import", imported.span),
        Declaration::TSExternalModuleDeclaration(_) | Declaration::TSGlobalDeclaration(_) => {}
    }
}

fn bindings<'a>(variables: &VariableDeclaration<'a>, statement: Span, exported: bool, visit: &mut impl FnMut(TopLevel<'a>)) {
    let kind = match variables.kind {
        VariableDeclarationKind::Var => "var",
        VariableDeclarationKind::Let => "let",
        VariableDeclarationKind::Const => "const",
        VariableDeclarationKind::Using => "using",
        VariableDeclarationKind::AwaitUsing => "await using",
    };
    for declarator in &variables.declarations {
        let signature = Span::new(variables.span.start, declarator_end(declarator));
        let destructured = declarator.id.get_binding_identifier().is_none();
        for id in declarator.id.get_binding_identifiers() {
            visit(TopLevel {
                name: id.name.as_str(),
                kind,
                statement,
                signature: Some(signature),
                declare: variables.declare,
                exported,
                default: false,
                destructured,
            });
        }
    }
}

fn default_export<'a>(declared: &ExportDefaultDeclarationKind<'a>, statement: Span, visit: &mut impl FnMut(TopLevel<'a>)) {
    let mut give = |name: Option<&oxc_ast::ast::BindingIdentifier<'a>>, kind: &'static str, signature: Option<Span>| {
        let given = TopLevel {
            name: "default",
            kind,
            statement,
            signature,
            declare: false,
            exported: true,
            default: true,
            destructured: false,
        };
        let named = name.map(|id| TopLevel { name: id.name.as_str(), default: false, ..given });
        visit(given);
        if let Some(named) = named {
            visit(named);
        }
    };
    match declared {
        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
            let end = function.body.as_ref().map_or(function.span.end, |body| body.span.start);
            give(function.id.as_ref(), "function", Some(Span::new(function.span.start, end)));
        }
        ExportDefaultDeclarationKind::ClassDeclaration(class) => {
            give(class.id.as_ref(), "class", Some(Span::new(class.span.start, class.body.span.start)));
        }
        ExportDefaultDeclarationKind::TSInterfaceDeclaration(interface) => give(
            Some(&interface.id),
            "interface",
            Some(Span::new(interface.span.start, interface.body.span.start)),
        ),
        ExportDefaultDeclarationKind::FunctionExpression(function) => {
            let end = function.body.as_ref().map_or(function.span.end, |body| body.span.start);
            give(None, "function", Some(Span::new(function.span.start, end)));
        }
        ExportDefaultDeclarationKind::ArrowFunctionExpression(arrow) => {
            give(None, "function", Some(Span::new(arrow.span.start, arrow.body.span().start)))
        }
        ExportDefaultDeclarationKind::ClassExpression(class) => {
            give(None, "class", Some(Span::new(class.span.start, class.body.span.start)))
        }
        ExportDefaultDeclarationKind::ObjectExpression(_) | ExportDefaultDeclarationKind::ArrayExpression(_) => {
            give(None, "object", None)
        }
        ExportDefaultDeclarationKind::Identifier(_) => {}
        _ => give(None, "const", None),
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
