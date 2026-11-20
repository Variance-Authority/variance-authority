// compass: variance-authority.report.agent-surface

use super::*;

fn readme(text: &str) -> Readme {
    Readme { from: "README.md".to_owned(), text: text.encode_utf16().collect() }
}

fn said(text: &str, name: &str) -> Option<(u32, String)> {
    mention(&readme(text), name).map(|found| (found.line, found.text))
}

#[test]
fn a_backticked_name_in_prose_is_read_before_a_bare_one_and_one_in_a_fence_last() {
    let text = "Bare name here.\n\n```\nname()\n```\n\nThen `name` quoted.";
    assert_eq!(said(text, "name"), Some((7, "Then `name` quoted.".to_owned())));
    assert_eq!(said("```\nname()\n```\n\nA bare name.", "name"), Some((5, "A bare name.".to_owned())));
    assert_eq!(said("Intro.\n\n```ts\nname();\n\nmore();\n```\n", "name"), Some((3, "```ts\nname();\n\nmore();\n```".to_owned())));
}

#[test]
fn a_name_inside_a_longer_word_is_no_mention() {
    assert_eq!(said("measurements and $measure and measure_", "measure"), None);
    assert_eq!(said("a $dollar sign", "$dollar"), Some((1, "a $dollar sign".to_owned())));
    assert_eq!(said("anything", ""), None);
}

#[test]
fn offsets_are_utf16_code_units_and_trimming_is_javascripts() {
    let text = "\u{feff}# Пакет 🚀\n\n🚀 `name` here.\u{3000}\u{a0}\n\nnext";
    assert_eq!(said(text, "name"), Some((3, "🚀 `name` here.".to_owned())));
}

#[test]
fn an_unclosed_fence_runs_to_the_end() {
    assert_eq!(said("Prose.\n\n```js\nname();\n\nstill", "name"), Some((3, "```js\nname();\n\nstill".to_owned())));
}

#[test]
fn a_long_passage_is_windowed_around_the_hit_and_says_where_it_cut() {
    let above: Vec<String> = (0..30).map(|at| format!("Line {at} of a section long enough to be cut above the hit.")).collect();
    let below: Vec<String> = (0..30).map(|at| format!("Line {at} of a section long enough to be cut below the hit.")).collect();
    let text = format!("{}\nThe `name` is here.\n{}", above.join("\n"), below.join("\n"));
    let (line, shown) = said(&text, "name").unwrap();
    assert!(shown.starts_with("…\n") && shown.ends_with("\n…") && shown.contains("`name`"), "{shown}");
    assert!(line > 1 && shown.chars().count() <= LONGEST + 4);
}

#[test]
fn the_nearest_readme_wins_even_when_it_does_not_name_the_name() {
    let held: HashMap<String, Option<Readme>> = [
        ("a/b/README.md", None),
        ("a/README.md", Some(Readme { from: "a/README.md".to_owned(), text: "near".encode_utf16().collect() })),
        ("README.md", Some(Readme { from: "README.md".to_owned(), text: "`name`".encode_utf16().collect() })),
    ]
    .into_iter()
    .map(|(from, readme)| (from.to_owned(), readme))
    .collect();
    let found = nearest(&held, "a/b/file.ts").unwrap();
    assert_eq!(found.from, "a/README.md");
    assert_eq!(mention(found, "name"), None);
    assert_eq!(candidates("file.ts").collect::<Vec<_>>(), vec!["README.md"]);
}

#[test]
fn a_crlf_gap_is_no_blank_line_as_javascript_reads_it() {
    assert_eq!(said("Intro.\r\n\r\nThen `name` here.", "name"), Some((1, "Intro.\r\n\r\nThen `name` here.".to_owned())));
}

#[test]
fn a_readme_that_is_there_and_does_not_read_refuses() {
    let root = std::env::temp_dir().join(format!("help-mention-unreadable-{}", std::process::id()));
    std::fs::create_dir_all(root.join("a/README.md")).unwrap();
    let read = readmes(&root, ["a/file.ts"].into_iter());
    std::fs::remove_dir_all(&root).unwrap();
    assert!(read.is_err_and(|refused| refused.starts_with("a/README.md is there and could not be read")));
}

#[test]
fn a_readme_farther_than_the_nearest_is_not_read() {
    let root = std::env::temp_dir().join(format!("help-mention-farther-{}", std::process::id()));
    std::fs::create_dir_all(root.join("README.md")).unwrap();
    std::fs::create_dir_all(root.join("a")).unwrap();
    std::fs::write(root.join("a/README.md"), "`name`").unwrap();
    let read = readmes(&root, ["a/file.ts"].into_iter());
    std::fs::remove_dir_all(&root).unwrap();
    let held = read.unwrap();
    assert_eq!(nearest(&held, "a/file.ts").map(|readme| readme.from.as_str()), Some("a/README.md"));
}
