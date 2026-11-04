//! What one file declares of a member: the line and the container it is on.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::member_declarations_in;
use crate::read::Lines;

fn on(text: &str, name: &str) -> Vec<(u32, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    member_declarations_in(&parsed.program, &Lines::new(text))
        .into_iter()
        .filter(|declared| declared.name == name)
        .map(|declared| (declared.line, declared.on))
        .collect()
}

#[test]
fn names_the_container_of_each_declaration() {
    let text = "interface Scanner {\n  m?(): void;\n}\ntype Held = {\n  m: number;\n};\nclass Impl {\n  m() {}\n}\nfunction f(x: { m: 1 }) {}\nconst o = { m: 1 };\nx.m();\n";
    let found = on(text, "m");
    let found: Vec<(u32, &str)> = found.iter().map(|(line, on)| (*line, on.as_str())).collect();
    assert_eq!(found, vec![(2, "Scanner"), (5, "Held"), (8, "Impl"), (10, "a type literal")]);
}

#[test]
fn a_constraint_is_not_the_alias_body() {
    let found = on("type X<T extends { m: 1 }> = {\n  m: 2;\n};\n", "m");
    assert_eq!(found, vec![(1, "a type literal".to_owned()), (2, "X".to_owned())]);
}

#[test]
fn an_alias_names_the_literals_its_intersection_or_union_joins() {
    let found = on("type X = Base & {\n  m: 1;\n};\ntype Y = { m: 2 } | { m: 3 };\ntype Z = Array<{ m: 4 }>;\n", "m");
    assert_eq!(found, vec![(2, "X".to_owned()), (4, "Y".to_owned()), (4, "Y".to_owned()), (5, "a type literal".to_owned())]);
}

#[test]
fn a_constructor_parameter_property_is_a_member() {
    let found = on("class Held {\n  constructor(private m: string, n: number) {}\n}\n", "m");
    assert_eq!(found, vec![(2, "Held".to_owned())]);
    assert!(on("class Held {\n  constructor(m: string) {}\n}\n", "m").is_empty());
}

#[test]
fn records_every_member_by_name() {
    let allocator = Allocator::default();
    let text = "interface A {\n  x: 1;\n  y(): void;\n}\nclass B {\n  ['computed' + 1] = 2;\n  z = 3;\n}\n";
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    let names: Vec<String> = member_declarations_in(&parsed.program, &Lines::new(text)).into_iter().map(|declared| declared.name).collect();
    assert_eq!(names, ["x", "y", "z"]);
}

/// Two layers the way the scan writes them: the newer one rewrites `a.ts`, its
/// declaration lower and a second container beside it, drops the declaration
/// from `c.ts`, and leaves `b.ts` to the older layer.
#[test]
fn reads_each_file_as_the_newest_layer_holds_it() {
    use crate::compact::Layer;
    use crate::generation::Delta;
    use crate::graph_index::merged;

    let root = std::env::temp_dir().join(format!("sense-help-members-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("package.json"), r#"{"name": "@t/w"}"#).unwrap();
    let record = |path: &str, digest: &str| format!(r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}"}}, "witnesses": []}}]"#);
    let parse = |digest: &str, declared: &str| format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [], "memberDeclarations": [{declared}]}}]"#);
    let generation = |document: String| merged(&[], &Delta::of(vec![document]).unwrap());
    let older = generation(format!(
        r#"{{"config": "v1:c", "records": [{}, {}, {}], "parses": [{}, {}, {}]}}"#,
        record("src/a.ts", "git:a1"),
        record("src/b.ts", "git:b1"),
        record("src/c.ts", "git:c1"),
        parse("git:a1", r#"{"name": "resolve", "line": 2, "on": "Scanner"}, {"name": "other", "line": 3, "on": "Scanner"}"#),
        parse("git:b1", r#"{"name": "resolve", "line": 2, "on": "Held"}"#),
        parse("git:c1", r#"{"name": "resolve", "line": 4, "on": "Legacy"}"#),
    ));
    let newer = generation(format!(
        r#"{{"records": [{}, {}], "parses": [{}, {}], "deletedParses": ["git:a1\u0000.ts\u0000+", "git:c1\u0000.ts\u0000+"]}}"#,
        record("src/a.ts", "git:a2"),
        record("src/c.ts", "git:c2"),
        parse("git:a2", r#"{"name": "later", "line": 9, "on": "Later"}, {"name": "resolve", "line": 10, "on": "Later"}, {"name": "resolve", "line": 5, "on": "Scanner"}"#),
        parse("git:c2", r#"{"name": "other", "line": 4, "on": "Legacy"}"#),
    ));
    let layers = [Layer::open(&older).unwrap(), Layer::open(&newer).unwrap()];

    let found: Vec<String> = super::member_declarations(root.to_str().unwrap(), &layers, "resolve")
        .into_iter()
        .map(|site| format!("{}:{} {} {} {}", site.at, site.line, site.on, site.by, site.kind))
        .collect();
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(found, [
        "src/a.ts:5 Scanner @t/w source",
        "src/a.ts:10 Later @t/w source",
        "src/b.ts:2 Held @t/w source",
    ]);
}
