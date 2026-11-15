//! What one file declares of a member: the line and the container it is on.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::member_declarations_in;
use crate::harvest::Harvest;
use crate::read::Lines;

fn on(text: &str, name: &str) -> Vec<(u32, String)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    let lines = Lines::new(text);
    member_declarations_in(&parsed.program, &lines, &Harvest::new(&parsed.program, text, &lines, false))
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
    let lines = Lines::new(text);
    let names: Vec<String> = member_declarations_in(&parsed.program, &lines, &Harvest::new(&parsed.program, text, &lines, false)).into_iter().map(|declared| declared.name).collect();
    assert_eq!(names, ["x", "y", "z"]);
}

/// The comment a member's first token follows, modifiers and decorators
/// included, is its doc, as a top-level declaration's is.
#[test]
fn keeps_the_doc_above_a_member() {
    let allocator = Allocator::default();
    let text = "interface A {\n  /** Who. */\n  readonly by: string;\n  bare: 1;\n}\nclass B {\n  /** Go. */\n  private go(): void {}\n  constructor(/** Held. */ private held: string) {}\n}\n";
    let parsed = Parser::new(&allocator, text, SourceType::ts()).parse();
    let lines = Lines::new(text);
    let docs: Vec<(String, Option<&str>)> = member_declarations_in(&parsed.program, &lines, &Harvest::new(&parsed.program, text, &lines, false))
        .into_iter()
        .map(|declared| (declared.name, declared.doc.map(|doc| &text[doc.start as usize..doc.end as usize])))
        .collect();
    let want = |name: &str, doc: Option<&'static str>| (name.to_owned(), doc);
    assert_eq!(docs, [want("by", Some("* Who. ")), want("bare", None), want("go", Some("* Go. ")), want("constructor", None), want("held", Some("* Held. "))]);
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

/// A chain of two layers over `root`, the newer one written from `newer`, each
/// record `(file, digest)` and each parse `(digest, member declarations, member uses)`.
fn chain(older: &[(&str, &str)], older_parses: &[(&str, &str, &str)], newer: &[(&str, &str)], newer_parses: &[(&str, &str, &str)], deleted: &[&str]) -> (Vec<u8>, Vec<u8>) {
    use crate::generation::Delta;
    use crate::graph_index::merged;

    let records = |records: &[(&str, &str)]| {
        records.iter().map(|(path, digest)| format!(r#"["{path}", {{"record": {{"file": "{path}", "digest": "{digest}"}}, "witnesses": []}}]"#)).collect::<Vec<_>>().join(", ")
    };
    let parses = |parses: &[(&str, &str, &str)]| {
        parses.iter().map(|(digest, declared, used)| format!(r#"["{digest}\u0000.ts\u0000+", {{"requests": [], "memberDeclarations": [{declared}], "memberUses": [{used}]}}]"#)).collect::<Vec<_>>().join(", ")
    };
    let deleted = deleted.iter().map(|file| format!(r#""{file}""#)).collect::<Vec<_>>().join(", ");
    let generation = |document: String| merged(&[], &Delta::of(vec![document]).unwrap());
    (
        generation(format!(r#"{{"config": "v1:c", "records": [{}], "parses": [{}]}}"#, records(older), parses(older_parses))),
        generation(format!(r#"{{"records": [{}], "parses": [{}], "deletedRecords": [{deleted}]}}"#, records(newer), parses(newer_parses))),
    )
}

/// A container's members come from its file's newest record: the newer
/// layer's parse of a file it rewrote, the older layer's of one it left, and
/// none of a file it deleted or the chain never held.
#[test]
fn members_on_reads_each_file_as_the_newest_layer_holds_it() {
    use crate::compact::Layer;

    let (older, newer) = chain(
        &[("src/a.ts", "git:a1"), ("src/b.ts", "git:b1"), ("src/d.ts", "git:d1")],
        &[
            ("git:a1", r#"{"name": "resolve", "line": 2, "on": "Scanner"}, {"name": "other", "line": 3, "on": "Scanner"}"#, ""),
            ("git:b1", r#"{"name": "resolve", "line": 2, "on": "Held"}"#, ""),
            ("git:d1", r#"{"name": "gone", "line": 1, "on": "Gone"}"#, ""),
        ],
        &[("src/a.ts", "git:a2")],
        &[("git:a2", r#"{"name": "resolve", "line": 5, "on": "Scanner"}, {"name": "later", "line": 9, "on": "Later"}"#, "")],
        &["src/d.ts"],
    );
    let layers = [Layer::open(&older).unwrap(), Layer::open(&newer).unwrap()];
    let members = |file: &str, on: &str| -> Vec<String> { super::members_on(&layers, file, on).into_iter().map(|member| format!("{}:{}", member.name, member.line)).collect() };

    assert_eq!(members("src/a.ts", "Scanner"), ["resolve:5"]);
    assert_eq!(members("src/b.ts", "Held"), ["resolve:2"]);
    assert_eq!(members("src/d.ts", "Gone"), Vec::<String>::new());
    assert_eq!(members("src/missing.ts", "Scanner"), Vec::<String>::new());
}

/// A file a newer layer deletes declares nothing, and a declaration's uses
/// are read from its file's newest parse, not from the one it replaced.
#[test]
fn a_member_and_its_uses_are_read_from_the_newest_record() {
    use crate::compact::Layer;

    let root = std::env::temp_dir().join(format!("sense-help-members-newest-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("package.json"), r#"{"name": "@t/w"}"#).unwrap();
    let (older, newer) = chain(
        &[("src/a.ts", "git:a1"), ("src/b.ts", "git:b1")],
        &[
            ("git:a1", r#"{"name": "resolve", "line": 2, "on": "Scanner"}"#, r#"{"name": "resolve", "line": 7, "of": "Scanner", "how": "read"}"#),
            ("git:b1", r#"{"name": "resolve", "line": 2, "on": "Held"}"#, ""),
        ],
        &[("src/a.ts", "git:a2")],
        &[("git:a2", r#"{"name": "resolve", "line": 3, "on": "Scanner"}"#, r#"{"name": "resolve", "line": 8, "of": "Scanner", "how": "write"}"#)],
        &["src/b.ts"],
    );
    let layers = [Layer::open(&older).unwrap(), Layer::open(&newer).unwrap()];

    let found: Vec<String> = super::member_declarations(root.to_str().unwrap(), &layers, "resolve")
        .into_iter()
        .map(|site| {
            let uses: Vec<String> = site.uses.unwrap_or_default().into_iter().map(|one| format!("{}:{} {}", one.at, one.line, one.how)).collect();
            format!("{}:{} {} uses [{}]", site.at, site.line, site.on, uses.join(", "))
        })
        .collect();
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(found, ["src/a.ts:3 Scanner uses [src/a.ts:8 write]"]);
}
