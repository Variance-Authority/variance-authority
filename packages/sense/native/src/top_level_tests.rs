//! The names a module's whole value spells, as `read_module` keeps them.

use oxc_allocator::Allocator;

use crate::read::read_module;

fn symbols(file: &str, source: &str) -> Vec<(String, &'static str, u32)> {
    let read = read_module(file, source, &Allocator::default(), true);
    read.symbols.into_iter().map(|symbol| (symbol.name, symbol.kind, symbol.line)).collect()
}

#[test]
fn a_named_function_handed_out_with_export_assignment_is_declared() {
    let found = symbols("a.cts", "const a = 1;\nexport = function plugin(): void {};\n");
    assert_eq!(found[1], ("plugin".to_owned(), "function", 2));
}

#[test]
fn a_named_class_handed_out_with_export_assignment_is_declared() {
    assert_eq!(symbols("a.cts", "export = class Reader {};\n"), [("Reader".to_owned(), "class", 1)]);
}

#[test]
fn a_named_function_handed_out_with_module_exports_is_declared() {
    assert_eq!(symbols("a.cjs", "module.exports = function reader() {};\n"), [("reader".to_owned(), "function", 1)]);
}

#[test]
fn a_value_that_spells_no_name_declares_nothing() {
    assert!(symbols("a.cts", "export = function () {};\n").is_empty());
    assert!(symbols("a.cjs", "module.exports = class {};\n").is_empty());
    assert!(symbols("a.cjs", "module.exports = () => {};\n").is_empty());
}

#[test]
fn an_assignment_adr_0097_leaves_unread_declares_nothing() {
    assert!(symbols("a.cjs", "exports.a = function named() {};\n").is_empty());
    assert!(symbols("a.cjs", "module.exports.a = function named() {};\n").is_empty());
    assert!(symbols("a.cjs", "function f() { module.exports = function named() {}; }\n").iter().all(|found| found.0 != "named"));
}
