//! The one walk over a file that every question about its readers is asked of:
//! each read and where it sits, each export and import, and whether any binding
//! is reached by a name the parser cannot match.

use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_syntax::scope::ScopeFlags;

use crate::module_shape::{plain_class, pure, Lines};

use super::{declared, Import, Read, Reading, Reexport, Where};

pub(super) fn reading_of(program: &Program, lines: &Lines) -> Reading {
    let mut walker = Walker {
        lines,
        reading: Reading {
            reads: Vec::new(),
            exports: BTreeMap::new(),
            imports: Vec::new(),
            reexports: Vec::new(),
            sources: BTreeSet::new(),
            effects: BTreeSet::new(),
            untraced: false,
        },
        namespaces: BTreeSet::new(),
        in_function: false,
        in_fields: false,
        converting: false,
        into: None,
    };
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        let source = import.source.value.to_string();
        walker.reading.sources.insert(source.clone());
        // `import { type A } from` keeps its braces, emptied; only `import './x'` has none.
        if import.specifiers.is_none() {
            walker.reading.effects.insert(source.clone());
        }
        for specifier in import.specifiers.iter().flatten() {
            let (local, imported) = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(it) => (&it.local, it.imported.name().to_string()),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(it) => (&it.local, "default".to_string()),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(it) => (&it.local, "*".to_string()),
            };
            if imported == "*" {
                walker.namespaces.insert(local.name.to_string());
            }
            walker.reading.imports.push(Import { local: local.name.to_string(), imported, source: source.clone() });
        }
    }
    for statement in &program.body {
        walker.top(statement);
    }
    walker.reading
}

struct Walker<'l> {
    lines: &'l Lines,
    reading: Reading,
    namespaces: BTreeSet<String>,
    in_function: bool,
    /// Walking a pure class's instance fields, which run when it is constructed.
    in_fields: bool,
    /// Walking the operands of a conversion.
    converting: bool,
    into: Option<String>,
}

impl Walker<'_> {
    fn read(&mut self, name: &str, offset: u32, escape: bool) {
        let at = if escape { Where::Escape } else if self.in_function { Where::Function } else { Where::Top };
        let into = if self.in_function { None } else { self.into.clone() };
        let converted = self.converting && !self.in_function && !self.in_fields;
        let nested = self.in_function || self.in_fields;
        let line = self.lines.at(offset);
        self.reading.reads.push(Read { name: name.to_string(), line, at, into, converted, nested });
    }

    fn export_as(&mut self, local: &str, name: &str) {
        self.reading.exports.entry(local.to_string()).or_default().push(name.to_string());
    }

    fn within(&mut self, value: Option<&Expression>, name: Option<String>) {
        let was = std::mem::replace(&mut self.into, name);
        if let Some(value) = value {
            self.visit_expression(value);
        }
        self.into = was;
    }

    fn inside(&mut self, run: impl FnOnce(&mut Self)) {
        let was = std::mem::replace(&mut self.in_function, true);
        run(self);
        self.in_function = was;
    }

    fn converted(&mut self, run: impl FnOnce(&mut Self)) {
        let was = std::mem::replace(&mut self.converting, true);
        run(self);
        self.converting = was;
    }

    /// A pure class's instance fields are values `new` reads, so a read in one
    /// moves the change to the class.
    fn class(&mut self, class: &Class, name: Option<&str>) {
        let Some(name) = name.filter(|_| plain_class(class)) else { return self.visit_class(class) };
        let was = std::mem::replace(&mut self.in_fields, true);
        for member in &class.body.body {
            match member {
                ClassElement::PropertyDefinition(field) if !field.r#static => {
                    self.within(field.value.as_ref(), Some(name.to_string()));
                }
                ClassElement::AccessorProperty(field) if !field.r#static => {
                    self.within(field.value.as_ref(), Some(name.to_string()));
                }
                member => self.visit_class_element(member),
            }
        }
        self.in_fields = was;
    }

    fn top(&mut self, statement: &Statement) {
        match statement {
            Statement::ImportDeclaration(_) => {}
            Statement::ExportFromDeclaration(it) => {
                let source = it.source.value.to_string();
                self.reading.sources.insert(source.clone());
                for specifier in &it.specifiers {
                    let taken = specifier.local.name().to_string();
                    let given = Some(specifier.exported.name().to_string());
                    self.reading.reexports.push(Reexport { taken, given, source: source.clone() });
                }
            }
            Statement::ExportAllDeclaration(it) => {
                let source = it.source.value.to_string();
                self.reading.sources.insert(source.clone());
                let given = it.exported.as_ref().map(|name| name.name().to_string());
                self.reading.reexports.push(Reexport { taken: "*".to_string(), given, source });
            }
            // A list's names are exports, not reads.
            Statement::ExportNamedDeclaration(it) => {
                for specifier in &it.specifiers {
                    self.export_as(&specifier.local.name(), &specifier.exported.name());
                }
            }
            Statement::ExportDeclaration(it) => {
                for name in declared(&it.declaration) {
                    self.export_as(&name, &name);
                }
                self.declaration(&it.declaration);
            }
            Statement::ExportDefaultDeclaration(it) => match &it.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    if let Some(id) = &function.id {
                        self.export_as(&id.name, "default");
                    }
                    self.visit_function(function, ScopeFlags::Function);
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) => match &class.id {
                    Some(id) => {
                        self.export_as(&id.name, "default");
                        self.class(class, Some(&id.name));
                    }
                    None => self.class(class, Some("default")),
                },
                ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
                ExportDefaultDeclarationKind::Identifier(id) => self.export_as(&id.name, "default"),
                declaration => {
                    let expression = declaration.to_expression();
                    self.within(Some(expression), pure(expression).then(|| "default".to_string()));
                }
            },
            statement => match statement.as_declaration() {
                Some(declaration) => self.declaration(declaration),
                None => self.visit_statement(statement),
            },
        }
    }

    fn declaration(&mut self, declaration: &Declaration) {
        match declaration {
            Declaration::VariableDeclaration(it) => {
                for declarator in &it.declarations {
                    match &declarator.id {
                        BindingPattern::BindingIdentifier(id) => {
                            let into = declarator.init.as_ref().is_none_or(pure).then(|| id.name.to_string());
                            self.within(declarator.init.as_ref(), into);
                        }
                        _ => self.visit_variable_declarator(declarator),
                    }
                }
            }
            Declaration::ClassDeclaration(class) => {
                let name = class.id.as_ref().map(|id| id.name.to_string());
                self.class(class, name.as_deref());
            }
            declaration => self.visit_declaration(declaration),
        }
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let escape = self.namespaces.contains(it.name.as_str());
        self.read(&it.name, it.span.start, escape);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        match &it.object {
            Expression::Identifier(object) if self.namespaces.contains(object.name.as_str()) => {
                self.read(&format!("{}.{}", object.name, it.property.name), it.span.start, false);
            }
            _ => walk::walk_static_member_expression(self, it),
        }
    }

    fn visit_jsx_member_expression(&mut self, it: &JSXMemberExpression<'a>) {
        match &it.object {
            JSXMemberExpressionObject::IdentifierReference(object) if self.namespaces.contains(object.name.as_str()) => {
                self.read(&format!("{}.{}", object.name, it.property.name), it.span.start, false);
            }
            _ => walk::walk_jsx_member_expression(self, it),
        }
    }

    // A conversion — `ToNumber`, `ToString`, `ToPropertyKey`, `ToPrimitive` — can
    // throw on the value or call its own `valueOf`, `toString` or
    // `Symbol.toPrimitive`. `in` throws on a primitive and runs a proxy's `has`;
    // `instanceof` runs `Symbol.hasInstance`. Strict equality, the logical
    // operators, a condition, `!`, `typeof` and `void` take any value without
    // running it.
    fn visit_binary_expression(&mut self, it: &BinaryExpression<'a>) {
        match it.operator {
            BinaryOperator::StrictEquality | BinaryOperator::StrictInequality => walk::walk_binary_expression(self, it),
            _ => self.converted(|walker| walk::walk_binary_expression(walker, it)),
        }
    }

    fn visit_unary_expression(&mut self, it: &UnaryExpression<'a>) {
        match it.operator {
            UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation | UnaryOperator::BitwiseNot => {
                self.converted(|walker| walk::walk_unary_expression(walker, it));
            }
            _ => walk::walk_unary_expression(self, it),
        }
    }

    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        self.converted(|walker| walk::walk_template_literal(walker, it));
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        match it.computed {
            true => self.converted(|walker| walker.visit_property_key(&it.key)),
            false => self.visit_property_key(&it.key),
        }
        self.visit_expression(&it.value);
    }

    // The opening tag already read the name.
    fn visit_jsx_closing_element(&mut self, _: &JSXClosingElement<'a>) {}

    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        self.inside(|walker| walk::walk_function(walker, it, flags));
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.inside(|walker| walk::walk_arrow_function_expression(walker, it));
    }

    // An instance field's value runs when the class is constructed, which is a
    // call like any other; a static one runs where the class is defined.
    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.visit_decorators(&it.decorators);
        if it.computed {
            self.visit_property_key(&it.key);
        }
        if let Some(value) = &it.value {
            match it.r#static {
                true => self.visit_expression(value),
                false => self.inside(|walker| walker.visit_expression(value)),
            }
        }
    }

    fn visit_accessor_property(&mut self, it: &AccessorProperty<'a>) {
        self.visit_decorators(&it.decorators);
        if it.computed {
            self.visit_property_key(&it.key);
        }
        if let Some(value) = &it.value {
            match it.r#static {
                true => self.visit_expression(value),
                false => self.inside(|walker| walker.visit_expression(value)),
            }
        }
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        self.reading.untraced = true;
        walk::walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if matches!(&it.callee, Expression::Identifier(callee) if callee.name == "require") {
            self.reading.untraced = true;
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        if matches!(it.module_reference, TSModuleReference::ExternalModuleReference(_)) {
            self.reading.untraced = true;
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }
}
