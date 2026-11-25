//! What `read_module` makes of the value of a `require`: a module held whole,
//! as the value of an awaited `import()` is.

use oxc_allocator::Allocator;

use crate::read::read_module;

/// Each `(request, name, line)` the module at `file` reads.
fn members_of(file: &str, source: &str) -> Vec<(String, String, u32)> {
    let read = read_module(file, source, &Allocator::default(), false);
    read.members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.name.clone(), member.line))
        .collect()
}

fn members(source: &str) -> Vec<(String, String, u32)> {
    members_of("a.cjs", source)
}

fn read(value: &str, name: &str, line: u32) -> (String, String, u32) {
    (value.to_owned(), name.to_owned(), line)
}

#[test]
fn a_destructured_require_reads_each_name_it_takes() {
    assert_eq!(
        members("const {\n  checkA,\n  checkB: renamed,\n} = require('./checks');\n"),
        [read("./checks", "checkA", 2), read("./checks", "checkB", 3)]
    );
}

#[test]
fn a_name_read_off_a_require_in_place_is_read_there() {
    assert_eq!(
        members("const checkC = require('./checks').checkC;\nrequire('./checks')['checkA'](1);\n"),
        [read("./checks", "checkC", 1), read("./checks", "checkA", 2)]
    );
}

#[test]
fn a_name_read_off_what_a_require_is_set_to_is_read_where_it_is() {
    assert_eq!(members("const checks = require('./checks');\n\nchecks.checkB(1);\n"), [read("./checks", "checkB", 3)]);
    assert_eq!(members("let checks;\nchecks = require('./checks');\nchecks.checkB(1);\n"), [read("./checks", "checkB", 3)]);
}

#[test]
fn a_require_inside_a_function_is_read_as_one_at_the_top_is() {
    assert_eq!(
        members("function late() {\n  const { checkA } = require('./checks');\n  const checks = require('./checks');\n  return checkA(checks.checkB, require('./checks').checkC);\n}\n"),
        [read("./checks", "checkA", 2), read("./checks", "checkB", 4), read("./checks", "checkC", 4)]
    );
}

#[test]
fn a_rest_of_a_require_holds_the_module() {
    assert_eq!(
        members("const { checkA, ...rest } = require('./checks');\nrest.checkB(1);\n"),
        [read("./checks", "checkA", 1), read("./checks", "checkB", 2)]
    );
}

#[test]
fn each_spelling_of_the_module_system_s_require_is_held() {
    assert_eq!(members("const { a } = module.require('./m');\n"), [read("./m", "a", 1)]);
    let made = "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nconst { a } = load('./m.cjs');\ncreateRequire(import.meta.url)('./n.cjs').b();\n";
    assert_eq!(members_of("a.mjs", made), [read("./m.cjs", "a", 3), read("./n.cjs", "b", 4)]);
}

#[test]
fn a_require_that_loads_nothing_this_can_name_records_no_name() {
    assert!(members("const { a } = require(name);\nrequire(`./${name}`).b();\n").is_empty());
    assert!(members("const { a } = loader.require('./m');\nrequire.resolve('./m').b;\n").is_empty());
    assert!(members("function load(path) { return path; }\nconst { a } = load('./m');\n").is_empty());
}

#[test]
fn a_require_nothing_is_read_off_records_no_name() {
    assert!(members("require('./m');\n").is_empty());
}

#[test]
fn what_is_read_off_a_require_makes_no_other_request_and_binds_nothing_in_it() {
    let source = "const { a } = require('./m');\nconst m = require('./n');\nm.b();\nrequire('./o').c();\nrequire(name).d();\n";
    let read = read_module("a.cjs", source, &Allocator::default(), false);
    let requests: Vec<(String, u32)> = read.requests.iter().map(|request| (request.value.clone(), request.line)).collect();
    assert_eq!(requests, [("./m".to_owned(), 1), ("./n".to_owned(), 2), ("./o".to_owned(), 4)]);
    assert!(read.requests.iter().all(|request| request.bindings.is_empty()));
    assert_eq!(read.unknown.as_deref(), Some("1 `require()` call(s) with a specifier this cannot read"));
}
