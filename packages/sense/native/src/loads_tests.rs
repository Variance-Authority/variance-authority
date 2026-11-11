//! What `read_module` makes of a load through a function `createRequire`
//! returned: bound to a `const` of any name, or called where it is made.

use oxc_allocator::Allocator;

use crate::read::read_module;

/// Each `(value, line)` a read takes for a request, and the reason it gives for
/// what it could not read.
fn loaded(source: &str) -> (Vec<(String, u32)>, Option<String>) {
    let read = read_module("a.mjs", source, &Allocator::default(), false);
    (read.requests.into_iter().map(|request| (request.value, request.line)).collect(), read.unknown)
}

fn found(values: &[(&str, u32)]) -> Vec<(String, u32)> {
    values.iter().map(|(value, line)| ((*value).to_owned(), *line)).collect()
}

const IMPORT: &str = "import { createRequire } from 'node:module';\n";

#[test]
fn a_load_through_a_const_of_any_name_is_a_request() {
    let source = format!("{IMPORT}const load = createRequire(import.meta.url);\nload('./x.cjs');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1), ("./x.cjs", 3)]), None));
}

#[test]
fn a_load_where_the_function_is_made_is_a_request() {
    let source = format!("{IMPORT}const z = createRequire(import.meta.url)('./z.json');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1), ("./z.json", 2)]), None));
}

#[test]
fn a_computed_specifier_through_either_is_counted_unread() {
    let source = format!("{IMPORT}const load = createRequire(import.meta.url);\nload(name);\ncreateRequire(import.meta.url)(`./${{name}}`);\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), Some("2 `require()` call(s) with a specifier this cannot read".to_owned())));
}

#[test]
fn create_require_is_read_under_an_alias_and_from_module() {
    let source = "import { createRequire as make } from 'module';\nconst req = make(import.meta.url);\nreq('./a.cjs');\n";
    assert_eq!(loaded(source), (found(&[("module", 1), ("./a.cjs", 3)]), None));
}

#[test]
fn a_function_named_load_that_no_create_require_made_loads_nothing() {
    let source = format!("{IMPORT}function load(path) {{ return path; }}\nload('./x.cjs');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), None));
}

#[test]
fn a_create_require_the_module_declares_itself_is_not_node_s() {
    let source = "const createRequire = () => (path) => path;\nconst load = createRequire(import.meta.url);\nload('./x.cjs');\ncreateRequire(import.meta.url)('./z.json');\n";
    assert_eq!(loaded(source), (vec![], None));
}

#[test]
fn a_parameter_that_shadows_the_binding_loads_nothing() {
    let source = format!("{IMPORT}const load = createRequire(import.meta.url);\nexport function read(load) {{ return load('./x.cjs'); }}\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), None));
}

#[test]
fn a_binding_that_can_be_assigned_again_is_not_followed() {
    let source = format!("{IMPORT}let load = createRequire(import.meta.url);\nload('./x.cjs');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), None));
}

#[test]
fn a_const_inside_a_function_is_followed_there() {
    let source = format!("{IMPORT}export function read() {{\n  const load = createRequire(import.meta.url);\n  return load('./x.cjs');\n}}\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1), ("./x.cjs", 4)]), None));
}

#[test]
fn a_function_made_for_another_file_loads_what_this_cannot_place() {
    let source = format!("{IMPORT}const load = createRequire(require.resolve('@playwright/test'));\nload('playwright/lib/util');\ncreateRequire(base)('./z.json');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), Some("2 `require()` call(s) with a specifier this cannot read".to_owned())));
}

#[test]
fn a_function_made_for_another_file_is_counted_unread_when_it_is_named_require() {
    let source = format!("{IMPORT}const require = createRequire(require.resolve('@playwright/test'));\nrequire('playwright/lib/util');\n");
    assert_eq!(loaded(&source), (found(&[("node:module", 1)]), Some("1 `require()` call(s) with a specifier this cannot read".to_owned())));
}
