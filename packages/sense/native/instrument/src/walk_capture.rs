//! What a region was handed: the values a story asks for, and nothing else does.
//!
//! A function region is entered with its parameters bound, and a module region
//! ends with its top-level bindings initialized. Both are values a reader of
//! one case wants to follow — the same object handed from a provider to a
//! consumer, the component a fiber names traced back to the binding that
//! declared it — and neither is anything a recording needs. So the call that
//! hands them over is dormant: `__vaL&&__vaL(region,"a,b",a,b)`. `__vaL` is
//! what the root handed the module at registration, and only a story's root
//! hands one over. Anywhere else the call is a read of a module variable and a
//! branch not taken; measured over 1,521 modules from `node_modules`, it adds
//! 0.7 ns to a function entry once optimized and 4.8 ns cold.
//!
//! The call stands in the body, after the region's probe, because that is the
//! first point every parameter has bound: a probe moved in front of the
//! parameters by `walk_params.rs` fires before they are. A generator's body is
//! not entered until its first `next()`, so a generator is left alone. The
//! names are the parameters' bindings, however destructured; `arguments` and a
//! TypeScript `this` parameter are not among them.
//!
//! At the end of a module the names are the bindings its own statements
//! declare: variables, functions and classes, exported or not. An import is
//! not one — a circular import can leave it in its dead zone when this module
//! ends, and it is the declaring module's binding, which that module hands
//! over at its own end. Nor is anything TypeScript erases: a `declare`, an
//! `enum`, a namespace, an import alias.

use oxc_ast::ast::*;

use crate::header::json_string;

/// The bindings a parameter list makes, in the order it makes them.
pub fn parameters(params: &FormalParameters) -> Vec<String> {
    let mut names = Vec::new();
    for item in &params.items {
        bound(&item.pattern, &mut names);
    }
    if let Some(rest) = &params.rest {
        bound(&rest.rest.argument, &mut names);
    }
    names
}

/// The bindings a module's own top-level statements declare.
pub fn module(program: &Program) -> Vec<String> {
    let mut names = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(it) => names.extend(declared(&it.declaration, Erased::Dropped)),
            Statement::ExportDefaultDeclaration(it) => match &it.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => function_name(function, &mut names),
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class_name(class, &mut names),
                _ => {}
            },
            other => {
                if let Some(declaration) = other.as_declaration() {
                    names.extend(declared(declaration, Erased::Dropped));
                }
            }
        }
    }
    names
}

/// The dormant call for `region`, or nothing when there is nothing to hand.
pub fn call(region: u32, names: &[String]) -> Option<String> {
    if names.is_empty() {
        return None;
    }
    let mut out = format!("__vaL&&__vaL({region},");
    json_string(&mut out, &names.join(","));
    for name in names {
        out.push(',');
        out.push_str(name);
    }
    out.push(')');
    Some(out)
}

/// Whether a declaration's names include what TypeScript erases: a `declare`,
/// an overload, an `enum`, a namespace, an import alias.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Erased {
    /// A reader of the source, which follows a type's name as it follows a value's.
    Kept,
    /// What the module holds once it has run.
    Dropped,
}

/// The names a declaration binds at top level, through any destructuring.
pub fn declared(declaration: &Declaration, erased: Erased) -> Vec<String> {
    let kept = erased == Erased::Kept;
    let mut names = Vec::new();
    match declaration {
        Declaration::VariableDeclaration(it) if kept || !it.declare => {
            it.declarations.iter().for_each(|it| bound(&it.id, &mut names))
        }
        Declaration::FunctionDeclaration(it) if kept => names.extend(it.id.as_ref().map(|id| id.name.to_string())),
        Declaration::FunctionDeclaration(it) => function_name(it, &mut names),
        Declaration::ClassDeclaration(it) if kept => names.extend(it.id.as_ref().map(|id| id.name.to_string())),
        Declaration::ClassDeclaration(it) => class_name(it, &mut names),
        Declaration::TSEnumDeclaration(it) if kept => names.push(it.id.name.to_string()),
        Declaration::TSNamespaceDeclaration(it) if kept => names.push(it.id.name.to_string()),
        Declaration::TSImportEqualsDeclaration(it) if kept => names.push(it.id.name.to_string()),
        _ => {}
    }
    names
}

fn function_name(function: &Function, names: &mut Vec<String>) {
    // An overload signature has no body and declares nothing that runs.
    if let (Some(id), false, true) = (&function.id, function.declare, function.body.is_some()) {
        names.push(id.name.to_string());
    }
}

fn class_name(class: &Class, names: &mut Vec<String>) {
    if let (Some(id), false) = (&class.id, class.declare) {
        names.push(id.name.to_string());
    }
}

/// The names a pattern binds, in the order it binds them.
pub fn bound(pattern: &BindingPattern, names: &mut Vec<String>) {
    names.extend(pattern.get_binding_identifiers().into_iter().map(|id| id.name.to_string()));
}

#[cfg(test)]
mod tests {
    use crate::cut::cut;

    fn code(source: &str, file: &str) -> String {
        cut(source, file, false).expect("it parses").code
    }

    #[test]
    fn a_function_hands_its_bound_parameters_after_its_probe() {
        let out = code("function f(a, b, ...e) { return a }\n", "f.js");
        assert!(out.contains("{__va(1);__vaL&&__vaL(1,\"a,b,e\",a,b,e); return a }"), "{out}");
    }

    #[test]
    fn a_function_whose_probe_moved_in_front_of_its_parameters_hands_them_in_its_body() {
        let out = code("function f(a, { b, c: [d] }, ...e) { return b }\n", "f.js");
        assert!(out.contains("{__vaL&&__vaL(1,\"a,b,d,e\",a,b,d,e); return b }"), "{out}");
        let out = code("const g = (a, { b }) => a + b;\n", "f.js");
        assert!(out.contains("=> (__vaL&&__vaL(1,\"a,b\",a,b),a + b)"), "{out}");
    }

    #[test]
    fn an_expression_arrow_hands_its_parameters_inside_the_expression() {
        let out = code("const g = (n) => n * 2;\n", "f.js");
        assert!(out.contains("(n) => (__va(1),__vaL&&__vaL(1,\"n\",n),n * 2)"), "{out}");
    }

    #[test]
    fn a_function_hands_its_parameters_after_its_directives() {
        let out = code("function f(a) { \"use strict\"; return a }\nfunction g(b) { 'use strict'\n return b }\n", "f.js");
        assert!(out.contains("\"use strict\";;__vaL&&__vaL(1,\"a\",a); return a }"), "{out}");
        assert!(out.contains("'use strict';__vaL&&__vaL(2,\"b\",b);\n return b }"), "{out}");
    }

    #[test]
    fn a_generator_and_a_function_with_no_parameters_hand_nothing() {
        let out = code("function* f(a) { yield a }\nfunction g() {}\n", "f.js");
        assert!(!out.contains("__vaL&&__vaL(1,"), "{out}");
        assert!(!out.contains("__vaL&&__vaL(2,"), "{out}");
    }

    #[test]
    fn a_module_hands_what_it_declares_and_not_what_it_imports_or_erases() {
        let source = "import y from 'y';\nconst { a } = y, b = 1;\nexport function F() {}\nexport default class C {}\nclass D {}\ndeclare const z: number;\nenum E { A }\nexport type T = 1;\nfunction o(x: string): void;\nfunction o(x) {}\n";
        let out = code(source, "f.ts");
        assert!(out.ends_with(";__vaL&&__vaL(0,\"a,b,F,C,D,o\",a,b,F,C,D,o);__vaE();\n"), "{out}");
    }

    #[test]
    fn a_module_that_declares_nothing_hands_nothing() {
        let out = code("import y from 'y';\ny();\n", "f.js");
        assert!(!out.contains("__vaL&&"), "{out}");
    }
}
