use super::*;

/// `finds every shape a stylesheet names a file in` in `sense.test.ts`.
#[test]
fn finds_every_shape_a_stylesheet_names_a_file_in() {
    let read = read_style(
        &[
            "@import './tokens.css';",
            "@use \"sass:math\";",
            "@forward './mixins';",
            ".b { background: url(./texture.png); }",
            ".c { background: url(\"https://cdn.example/x.png\"); }",
            ".d { composes: base from './base.module.css'; }",
        ]
        .join("\n"),
    );
    let values: Vec<&str> = read.requests.iter().map(|request| request.value.as_str()).collect();
    assert_eq!(values, ["./tokens.css", "sass:math", "./mixins", "./texture.png", "./base.module.css"]);
    assert!(read.requests.iter().all(|request| request.kind == Kind::Asset && request.bindings.is_empty()));
    assert_eq!(read.requests.iter().map(|request| request.line).collect::<Vec<_>>(), [1, 2, 3, 4, 6]);
    assert!(read.harvested && read.size.is_none() && read.unknown.is_none());
}

/// Each pattern is applied whole before the next, as the oracle does, so an
/// `@import url(…)` is read twice and kept twice.
#[test]
fn reads_pattern_by_pattern_and_keeps_repeats() {
    let read = read_style("@import url('./a.css');\n.x { background: url( ' ./b.png ' ); }");
    let values: Vec<&str> = read.requests.iter().map(|request| request.value.as_str()).collect();
    assert_eq!(values, ["./a.css", "./a.css", "./b.png"]);
}

#[test]
fn a_word_boundary_is_ascii() {
    // `éurl(` has no ASCII word character before `url`, so the oracle reads it.
    assert_eq!(read_style("éurl(./a.png)").requests.len(), 1);
    assert!(read_style("xurl(./a.png)").requests.is_empty());
}

#[test]
fn a_specifier_takes_its_partial_and_tilde_forms() {
    assert_eq!(style_requests("./colors"), ["./colors", "./_colors"]);
    assert_eq!(style_requests("colors"), ["colors", "_colors"]);
    assert_eq!(style_requests("~pkg/theme"), ["pkg/theme", "pkg/_theme", "~pkg/theme"]);
}
