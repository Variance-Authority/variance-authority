//! What `read_module` makes of a name read off a binding a named import takes:
//! `ns.x` after `import { ns } from 'm'`, which reads `x` off `ns` only when
//! `m` passes `ns` on as a namespace, which the query decides.

use oxc_allocator::Allocator;

use super::read_module;

/// Each `(request, binding, name, line)` the module reads off a named binding.
fn binding_members(source: &str) -> Vec<(String, String, String, u32)> {
    let read = read_module("a.ts", source, &Allocator::default(), false);
    read.binding_members
        .iter()
        .map(|member| (read.requests[member.request as usize].value.clone(), member.binding.clone(), member.name.clone(), member.line))
        .collect()
}

fn read(value: &str, binding: &str, name: &str, line: u32) -> (String, String, String, u32) {
    (value.to_owned(), binding.to_owned(), name.to_owned(), line)
}

#[test]
fn a_name_read_off_a_named_binding_is_recorded_under_the_name_it_imports() {
    let source = concat!(
        "import { shout, other as renamed } from './lib';\n",
        "shout.greet('a');\n",
        "const { quiet } = shout;\n",
        "shout['loud'];\n",
        "renamed.size;\n",
        "const held = shout;\n",
        "held.again;\n",
    );
    assert_eq!(
        binding_members(source),
        [
            read("./lib", "other", "size", 5),
            read("./lib", "shout", "again", 7),
            read("./lib", "shout", "greet", 2),
            read("./lib", "shout", "loud", 4),
            read("./lib", "shout", "quiet", 3),
        ]
    );
}

#[test]
fn a_type_query_off_a_named_binding_reads_its_first_name() {
    let source = "import type { shout } from './lib';\nexport type Greet = typeof shout.greet.length;\n";
    assert_eq!(binding_members(source), [read("./lib", "shout", "greet", 2)]);
}

#[test]
fn a_named_binding_that_escapes_or_is_shadowed_reads_nothing_by_name() {
    let source = concat!(
        "import { shout } from './lib';\n",
        "export const all = [shout];\n",
        "export { shout };\n",
        "function f(shout: { x: number }) {\n",
        "  return shout.x;\n",
        "}\n",
        "shout.default.inner;\n",
    );
    assert_eq!(binding_members(source), [read("./lib", "shout", "default", 7)]);
    let read = read_module("a.ts", source, &Allocator::default(), false);
    assert_eq!(read.members, []);
}
