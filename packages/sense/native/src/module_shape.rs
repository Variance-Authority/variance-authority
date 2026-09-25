//! A module as selection reads a change to it: the program the compiler would
//! emit, with every type, overload and ambient declaration taken out, so two
//! texts that run the same compare equal under oxc's own `ContentEq`, which
//! already ignores positions and comments.
//!
//! What is taken out is exactly what TypeScript erases. What is kept runs, even
//! where it is written in TypeScript's syntax: a parameter property, a
//! enum, `const` or not, a namespace with values, a class field with no initializer
//! (a define under `useDefineForClassFields`). Keeping one that turns out to
//! emit nothing selects more; erasing one that runs would select less, so every
//! doubt is kept.
//!
//! A decorated class keeps its types. Under `emitDecoratorMetadata` TypeScript
//! writes the annotations of a decorated class's constructor parameters, its
//! decorated members and their parameters and return types into `__metadata`
//! calls that run when the class is defined, and a dependency-injection
//! container reads them to decide what to construct. Whether the option is on
//! is a `tsconfig.json` fact this text does not carry, so every decorated class
//! is read as though it were: a type edit there selects, which is the direction
//! a doubt is resolved in.
//!
//! `bodies: false` also empties every function — its parameters and its body —
//! which is the program as the module's own evaluation sees it: a function is
//! created, and nothing in it runs until something calls. A decorated class's
//! methods keep their parameters' decorators and annotations, which run when
//! the class is defined, and lose only their defaults and bodies.

use oxc_allocator::{Allocator, TakeIn, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast_visit::{walk_mut, VisitMut};
use oxc_parser::{ParseOptions, Parser};
use oxc_span::SourceType;
use oxc_syntax::scope::ScopeFlags;

/// The program, erased and optionally emptied, or nothing when the parser
/// reported any error: a change is read only from two texts that both parse.
pub fn parse<'a>(allocator: &'a Allocator, file: &str, text: &'a str, bodies: bool) -> Option<Program<'a>> {
    let source_type = crate::read::dialect(file).unwrap_or_default();
    let options = ParseOptions { preserve_parens: false, ..ParseOptions::default() };
    let parsed = Parser::new(allocator, text, source_type).with_options(options).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let mut program = parsed.program;
    Erase { allocator, bodies, typed: false }.visit_program(&mut program);
    Some(program)
}

/// A 1-based line for any byte offset of one text.
pub struct Lines(Vec<u32>);

impl Lines {
    pub fn new(text: &str) -> Lines {
        let mut starts = vec![0];
        starts.extend(text.bytes().enumerate().filter(|(_, byte)| *byte == b'\n').map(|(at, _)| at as u32 + 1));
        Lines(starts)
    }

    pub fn at(&self, offset: u32) -> u32 {
        self.0.partition_point(|&start| start <= offset) as u32
    }
}

/// True for a statement the compiler removes before the module runs.
pub fn erased(statement: &Statement) -> bool {
    if let Some(declaration) = statement.as_declaration() {
        return erased_declaration(declaration);
    }
    match statement {
        Statement::ImportDeclaration(it) => it.import_kind.is_type(),
        Statement::ExportAllDeclaration(it) => it.export_kind.is_type(),
        Statement::ExportNamedDeclaration(it) => it.export_kind.is_type(),
        Statement::ExportFromDeclaration(it) => it.export_kind.is_type(),
        Statement::ExportDeclaration(it) => erased_declaration(&it.declaration),
        Statement::ExportDefaultDeclaration(it) => match &it.declaration {
            ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => true,
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.body.is_none(),
            ExportDefaultDeclarationKind::ClassDeclaration(class) => class.declare,
            _ => false,
        },
        Statement::TSNamespaceExportDeclaration(_) => true,
        _ => false,
    }
}

fn erased_declaration(declaration: &Declaration) -> bool {
    match declaration {
        Declaration::VariableDeclaration(it) => it.declare,
        // An overload, or `declare function`: a signature with no body.
        Declaration::FunctionDeclaration(it) => it.declare || it.body.is_none(),
        Declaration::ClassDeclaration(it) => it.declare,
        Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_) => true,
        // An enum is emitted as a function that runs when the module does, a
        // `const` one too: a transform that sees one file at a time cannot
        // inline it into the files that read it.
        Declaration::TSEnumDeclaration(it) => it.declare,
        Declaration::TSExternalModuleDeclaration(_) | Declaration::TSGlobalDeclaration(_) => true,
        Declaration::TSNamespaceDeclaration(it) => it.declare,
        Declaration::TSImportEqualsDeclaration(it) => it.import_kind.is_type(),
    }
}

fn erased_member(member: &ClassElement) -> bool {
    match member {
        ClassElement::TSIndexSignature(_) => true,
        ClassElement::MethodDefinition(it) => {
            it.value.body.is_none() || it.r#type == MethodDefinitionType::TSAbstractMethodDefinition
        }
        ClassElement::PropertyDefinition(it) => {
            it.declare || it.r#type == PropertyDefinitionType::TSAbstractPropertyDefinition
        }
        ClassElement::AccessorProperty(it) => it.r#type == AccessorPropertyType::TSAbstractAccessorProperty,
        ClassElement::StaticBlock(_) => false,
    }
}

struct Erase<'a> {
    allocator: &'a Allocator,
    bodies: bool,
    /// Inside a decorated class and outside any function body in it, where an
    /// annotation can be emitted as metadata.
    typed: bool,
}

/// Whether anything in a class's own declaration is decorated: the class, a
/// member, or a parameter of a member.
pub fn decorated(class: &Class) -> bool {
    let parameters = |function: &Function| function.params.items.iter().any(|it| !it.decorators.is_empty());
    !class.decorators.is_empty()
        || class.body.body.iter().any(|member| match member {
            ClassElement::MethodDefinition(it) => !it.decorators.is_empty() || parameters(&it.value),
            ClassElement::PropertyDefinition(it) => !it.decorators.is_empty(),
            ClassElement::AccessorProperty(it) => !it.decorators.is_empty(),
            ClassElement::StaticBlock(_) | ClassElement::TSIndexSignature(_) => false,
        })
}

impl<'a> VisitMut<'a> for Erase<'a> {
    fn visit_statements(&mut self, it: &mut ArenaVec<'a, Statement<'a>>) {
        it.retain(|statement| !erased(statement));
        walk_mut::walk_statements(self, it);
    }

    /// A wrapper whose runtime is the expression it holds.
    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        loop {
            let inner = match it {
                Expression::TSAsExpression(wrapper) => wrapper.expression.take_in(&self.allocator),
                Expression::TSSatisfiesExpression(wrapper) => wrapper.expression.take_in(&self.allocator),
                Expression::TSNonNullExpression(wrapper) => wrapper.expression.take_in(&self.allocator),
                Expression::TSTypeAssertion(wrapper) => wrapper.expression.take_in(&self.allocator),
                Expression::TSInstantiationExpression(wrapper) => wrapper.expression.take_in(&self.allocator),
                Expression::ParenthesizedExpression(wrapper) => wrapper.expression.take_in(&self.allocator),
                _ => break,
            };
            *it = inner;
        }
        walk_mut::walk_expression(self, it);
    }

    fn visit_function(&mut self, it: &mut Function<'a>, flags: ScopeFlags) {
        it.declare = false;
        it.type_parameters = None;
        it.this_param = None;
        if !self.typed {
            it.return_type = None;
        }
        if !self.bodies {
            if self.typed {
                for parameter in it.params.items.iter_mut() {
                    parameter.initializer = None;
                }
                self.visit_formal_parameters(&mut it.params);
            } else {
                it.params.items.clear();
            }
            it.params.rest = None;
            if let Some(body) = &mut it.body {
                body.directives.clear();
                body.statements.clear();
            }
            return;
        }
        walk_mut::walk_function(self, it, flags);
    }

    // No metadata is emitted for what a function body declares, whatever class
    // it sits in.
    fn visit_function_body(&mut self, it: &mut FunctionBody<'a>) {
        let outer = std::mem::replace(&mut self.typed, false);
        walk_mut::walk_function_body(self, it);
        self.typed = outer;
    }

    fn visit_arrow_function_expression(&mut self, it: &mut ArrowFunctionExpression<'a>) {
        it.type_parameters = None;
        it.return_type = None;
        if !self.bodies {
            it.params.items.clear();
            it.params.rest = None;
            let _ = it.body.take_in(&self.allocator);
            return;
        }
        let outer = std::mem::replace(&mut self.typed, false);
        walk_mut::walk_arrow_function_expression(self, it);
        self.typed = outer;
    }

    // A parameter's `private` or `readonly` makes it a property the constructor
    // assigns, so both stay; only the annotation and `?` are erased.
    fn visit_formal_parameter(&mut self, it: &mut FormalParameter<'a>) {
        if !self.typed {
            it.type_annotation = None;
        }
        it.optional = false;
        walk_mut::walk_formal_parameter(self, it);
    }

    fn visit_formal_parameters(&mut self, it: &mut FormalParameters<'a>) {
        if let Some(rest) = &mut it.rest {
            if !self.typed {
                rest.type_annotation = None;
            }
        }
        walk_mut::walk_formal_parameters(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &mut VariableDeclarator<'a>) {
        it.type_annotation = None;
        it.definite = false;
        walk_mut::walk_variable_declarator(self, it);
    }

    fn visit_catch_parameter(&mut self, it: &mut CatchParameter<'a>) {
        it.type_annotation = None;
        walk_mut::walk_catch_parameter(self, it);
    }

    fn visit_class(&mut self, it: &mut Class<'a>) {
        it.type_parameters = None;
        it.implements.clear();
        it.r#abstract = false;
        if let Some(heritage) = &mut it.heritage {
            heritage.type_arguments = None;
        }
        it.body.body.retain(|member| !erased_member(member));
        let outer = std::mem::replace(&mut self.typed, decorated(it));
        walk_mut::walk_class(self, it);
        self.typed = outer;
    }

    fn visit_method_definition(&mut self, it: &mut MethodDefinition<'a>) {
        it.r#override = false;
        it.optional = false;
        it.accessibility = None;
        walk_mut::walk_method_definition(self, it);
    }

    fn visit_property_definition(&mut self, it: &mut PropertyDefinition<'a>) {
        if !self.typed {
            it.type_annotation = None;
        }
        it.r#override = false;
        it.optional = false;
        it.definite = false;
        it.readonly = false;
        it.accessibility = None;
        walk_mut::walk_property_definition(self, it);
    }

    fn visit_accessor_property(&mut self, it: &mut AccessorProperty<'a>) {
        if !self.typed {
            it.type_annotation = None;
        }
        it.r#override = false;
        it.definite = false;
        it.accessibility = None;
        walk_mut::walk_accessor_property(self, it);
    }

    fn visit_call_expression(&mut self, it: &mut CallExpression<'a>) {
        it.type_arguments = None;
        walk_mut::walk_call_expression(self, it);
    }

    fn visit_new_expression(&mut self, it: &mut NewExpression<'a>) {
        it.type_arguments = None;
        walk_mut::walk_new_expression(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &mut TaggedTemplateExpression<'a>) {
        it.type_arguments = None;
        walk_mut::walk_tagged_template_expression(self, it);
    }

    fn visit_jsx_opening_element(&mut self, it: &mut JSXOpeningElement<'a>) {
        it.type_arguments = None;
        walk_mut::walk_jsx_opening_element(self, it);
    }

    fn visit_import_declaration(&mut self, it: &mut ImportDeclaration<'a>) {
        if let Some(specifiers) = &mut it.specifiers {
            specifiers.retain(|specifier| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(it) => !it.import_kind.is_type(),
                _ => true,
            });
        }
        walk_mut::walk_import_declaration(self, it);
    }

    fn visit_export_named_declaration(&mut self, it: &mut ExportNamedDeclaration<'a>) {
        it.specifiers.retain(|specifier| !specifier.export_kind.is_type());
        walk_mut::walk_export_named_declaration(self, it);
    }

    fn visit_export_from_declaration(&mut self, it: &mut ExportFromDeclaration<'a>) {
        it.specifiers.retain(|specifier| !specifier.export_kind.is_type());
        walk_mut::walk_export_from_declaration(self, it);
    }
}

/// Whether evaluating this expression can run anything but itself.
///
/// A call, a `new`, a tagged template, a property read (a getter), a spread (an
/// iterator), an `await`, an assignment: each runs code the text does not show.
/// A function is pure however much its body does, because its body does not run
/// here.
pub fn pure(expression: &Expression) -> bool {
    match expression {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::Identifier(_)
        | Expression::ThisExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ArrowFunctionExpression(_) => true,
        Expression::TemplateLiteral(it) => it.expressions.iter().all(pure),
        Expression::ArrayExpression(it) => it.elements.iter().all(|element| match element {
            ArrayExpressionElement::SpreadElement(_) => false,
            ArrayExpressionElement::Elision(_) => true,
            element => element.as_expression().is_some_and(pure),
        }),
        Expression::ObjectExpression(it) => it.properties.iter().all(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                (!property.computed || property.key.as_expression().is_none_or(pure)) && pure(&property.value)
            }
            ObjectPropertyKind::SpreadProperty(_) => false,
        }),
        Expression::UnaryExpression(it) => it.operator != UnaryOperator::Delete && pure(&it.argument),
        Expression::BinaryExpression(it) => pure(&it.left) && pure(&it.right),
        Expression::LogicalExpression(it) => pure(&it.left) && pure(&it.right),
        Expression::ConditionalExpression(it) => pure(&it.test) && pure(&it.consequent) && pure(&it.alternate),
        Expression::ClassExpression(it) => plain_class(it),
        _ => false,
    }
}

/// A class whose definition runs nothing: no base expression, no decorator on
/// it, a member or a parameter of one, no static field or block, no computed
/// key. Its instance fields run when it is constructed, which is a value the
/// class carries rather than a load.
pub fn plain_class(class: &Class) -> bool {
    class.heritage.is_none()
        && !decorated(class)
        && class.body.body.iter().all(|member| match member {
            ClassElement::StaticBlock(_) | ClassElement::TSIndexSignature(_) => false,
            ClassElement::MethodDefinition(it) => !it.computed,
            ClassElement::PropertyDefinition(it) => !it.computed && !it.r#static,
            ClassElement::AccessorProperty(it) => !it.computed && !it.r#static,
        })
}
