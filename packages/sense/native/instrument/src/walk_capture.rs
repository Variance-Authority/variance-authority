//! What a function was handed: the values a story asks for, and nothing else does.
//!
//! A function region is entered with its parameters bound. A reader of one
//! case wants to follow those values — the same object handed from a provider
//! to a consumer, the component a fiber names traced back to the call that
//! handed it over — and a recording needs none of them. So the call that
//! hands them over is dormant: `__vaL&&__vaL("a,b",a,b)`. `__vaL` is
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
//! TypeScript `this` parameter are not among them. A module's own top-level
//! bindings are not handed over: they are state at a point in time, and a
//! story follows what is handed.

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

/// The dormant call that hands `names` over, or nothing when there is nothing to hand.
pub fn call(names: &[String]) -> Option<String> {
    if names.is_empty() {
        return None;
    }
    let mut out = String::from("__vaL&&__vaL(");
    json_string(&mut out, &names.join(","));
    for name in names {
        out.push(',');
        out.push_str(name);
    }
    out.push(')');
    Some(out)
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
        assert!(out.contains("{__va(1);__vaL&&__vaL(\"a,b,e\",a,b,e); return a }"), "{out}");
    }

    #[test]
    fn a_function_whose_probe_moved_in_front_of_its_parameters_hands_them_in_its_body() {
        let out = code("function f(a, { b, c: [d] }, ...e) { return b }\n", "f.js");
        assert!(out.contains("{__vaL&&__vaL(\"a,b,d,e\",a,b,d,e); return b }"), "{out}");
        let out = code("const g = (a, { b }) => a + b;\n", "f.js");
        assert!(out.contains("=> (__vaL&&__vaL(\"a,b\",a,b),a + b)"), "{out}");
    }

    #[test]
    fn an_expression_arrow_hands_its_parameters_inside_the_expression() {
        let out = code("const g = (n) => n * 2;\n", "f.js");
        assert!(out.contains("(n) => (__va(1),__vaL&&__vaL(\"n\",n),n * 2)"), "{out}");
    }

    #[test]
    fn a_function_hands_its_parameters_after_its_directives() {
        let out = code("function f(a) { \"use strict\"; return a }\nfunction g(b) { 'use strict'\n return b }\n", "f.js");
        assert!(out.contains("\"use strict\";;__vaL&&__vaL(\"a\",a); return a }"), "{out}");
        assert!(out.contains("'use strict';__vaL&&__vaL(\"b\",b);\n return b }"), "{out}");
    }

    #[test]
    fn a_generator_and_a_function_with_no_parameters_hand_nothing() {
        let out = code("function* f(a) { yield a }\nfunction g() {}\n", "f.js");
        assert!(!out.contains("__vaL&&__vaL("), "{out}");
    }

    #[test]
    fn a_module_hands_nothing_at_its_end() {
        let source = "import y from 'y';\nconst { a } = y, b = 1;\nexport function F() {}\nexport default class C {}\nclass D {}\n";
        let out = code(source, "f.ts");
        assert!(out.ends_with("class D {};__vaE();\n"), "{out}");
        assert!(!out.contains("__vaL&&__vaL("), "{out}");
    }
}
