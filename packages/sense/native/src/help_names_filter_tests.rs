//! A file's names are read off the parse the index holds, with no file on any
//! disk: what it declares and what it imports, as `namesOf` read them.

use oxc_allocator::Allocator;

use super::{names_filter, ImportAsked, NameHit};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index::{parses_only, way};
use crate::read::{read_module, Read};

/// A records layer naming each file at its digest with the target each request
/// resolved to, and a parse layer written from each file's read.
fn chain(files: &[(&str, &str, &str, &[Option<&str>])]) -> (Vec<u8>, Vec<u8>) {
    let records: Vec<String> = files
        .iter()
        .map(|(file, digest, _, targets)| {
            let targets: Vec<String> = targets.iter().map(|one| one.map_or("null".to_owned(), |to| format!("\"{to}\""))).collect();
            format!(r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#, targets.join(", "))
        })
        .collect();
    let document = format!(r#"{{"records": [{}], "parses": [], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "));
    let reads: Vec<(String, Read)> = files
        .iter()
        .map(|(file, digest, source, _)| (crate::parse_store::key(digest, &way(file)), read_module(file, source, &Allocator::default(), true)))
        .collect();
    let mut rows: Vec<(&str, &Read)> = reads.iter().map(|(key, read)| (key.as_str(), read)).collect();
    rows.sort_unstable_by(|left, right| crate::order::code_unit(left.0, right.0));
    (merged(&[], &Delta::of(vec![document]).unwrap()), parses_only(&rows))
}

const THEME: &str = "import { createContext, useContext as read } from 'react';\n\
import * as palette from './palette';\n\
import './side-effect.css';\n\
import { selectBalance } from './store';\n\
export const ThemeContext = createContext(palette.dark);\n\
const own = 1;\n\
export default selectBalance;\n\
export { Forwarded } from './forwarded';\n";
const THEME_TARGETS: &[Option<&str>] = &[None, Some("src/palette.ts"), Some("src/side-effect.css"), Some("src/store.ts"), Some("src/forwarded.ts")];

fn found(files: &[(&str, &str, &str, &[Option<&str>])], imports: &[(&str, Option<&str>)], declares: &[&str]) -> super::NamesFound {
    let (records, parses) = chain(files);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let imports: Vec<ImportAsked> = imports.iter().map(|(spec, name)| ImportAsked { spec: (*spec).to_owned(), name: name.map(str::to_owned) }).collect();
    let declares: Vec<String> = declares.iter().map(|one| (*one).to_owned()).collect();
    names_filter(&layers, &imports, &declares, &[".ts".to_owned()])
}

fn said(hits: &[NameHit]) -> Vec<String> {
    hits.iter()
        .map(|hit| {
            let mut one = format!("{}:{} {}", hit.file, hit.line, hit.name.as_deref().unwrap_or("-"));
            for (key, value) in [("from", &hit.from), ("as", &hit.local), ("through", &hit.through)] {
                if let Some(value) = value {
                    one.push_str(&format!(" {key} {value}"));
                }
            }
            one
        })
        .collect()
}

#[test]
fn declares_its_own_names_once_never_an_export_of_an_imported_name() {
    let answer = found(&[("src/theme.ts", "git:a", THEME, THEME_TARGETS)], &[], &["."]);
    assert_eq!(said(&answer.declares[0].hits), vec!["src/theme.ts:5 ThemeContext", "src/theme.ts:6 own"]);
}

#[test]
fn a_default_with_a_name_of_its_own_is_declared_under_that_name() {
    let made = "export default function make() {}\n";
    let answer = found(&[("src/made.ts", "git:a", made, &[])], &[], &["^(make|default)$"]);
    assert_eq!(said(&answer.declares[0].hits), vec!["src/made.ts:1 make"]);
}

#[test]
fn declares_matches_without_case_and_refuses_a_pattern_that_is_no_regular_expression() {
    let answer = found(&[("src/theme.ts", "git:a", THEME, THEME_TARGETS)], &[], &["^themecontext$", "("]);
    assert_eq!(said(&answer.declares[0].hits), vec!["src/theme.ts:5 ThemeContext"]);
    assert!(answer.declares[1].refused.is_some());
}

#[test]
fn imports_each_binding_by_the_name_its_module_publishes_and_each_member_off_a_namespace() {
    let answer = found(&[("src/theme.ts", "git:a", THEME, THEME_TARGETS)], &[("react", None), ("src/palette.ts", Some("dark"))], &[]);
    assert_eq!(said(&answer.imports[0]), vec!["src/theme.ts:1 createContext from react", "src/theme.ts:1 useContext from react as read"]);
    assert_eq!(said(&answer.imports[1]), vec!["src/theme.ts:5 dark from ./palette through palette"]);
}

#[test]
fn a_module_that_binds_nothing_is_still_imported_and_a_package_subpath_is_its_package() {
    let jsx = "import { jsx } from 'react/jsx-runtime';\nimport './reactor';\n";
    let files: &[(&str, &str, &str, &[Option<&str>])] =
        &[("src/theme.ts", "git:a", THEME, THEME_TARGETS), ("src/jsx.ts", "git:b", jsx, &[None, Some("src/reactor.ts")])];
    let answer = found(files, &[("./side-effect.css", None), ("react", Some("jsx")), ("./react", None)], &[]);
    assert_eq!(said(&answer.imports[0]), vec!["src/theme.ts:3 - from ./side-effect.css"]);
    assert_eq!(said(&answer.imports[1]), vec!["src/jsx.ts:1 jsx from react/jsx-runtime"]);
    assert!(answer.imports[2].is_empty());
}

#[test]
fn a_file_the_chain_holds_no_parse_of_is_unread_when_its_extension_is_readable() {
    let (records, _) = chain(&[("src/a.ts", "git:a", "", &[]), ("README.md", "git:b", "", &[])]);
    let (_, parses) = chain(&[("src/other.ts", "git:c", "export const a = 1;\n", &[])]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let answer = names_filter(&layers, &[], &["a".to_owned()], &[".ts".to_owned()]);
    assert_eq!(answer.unread, vec!["src/a.ts".to_owned()]);
    assert!(answer.declares[0].hits.is_empty());
}

#[test]
fn an_export_of_an_imported_name_or_a_namespace_declares_nothing_and_a_function_body_declares_nothing() {
    let passed = "import { ThemeContext } from './theme';\nexport default ThemeContext;\nexport { ThemeContext as Renamed };\n";
    let spaced = "import * as theme from './theme';\nexport { theme };\n";
    let closure = "import { ThemeContext } from './theme';\nexport function run() {\n  const ThemeContext = () => 0;\n  return ThemeContext();\n}\nexport { ThemeContext };\n";
    let files: &[(&str, &str, &str, &[Option<&str>])] = &[
        ("src/closure.ts", "git:c", closure, &[Some("src/theme.ts")]),
        ("src/passed.ts", "git:a", passed, &[Some("src/theme.ts")]),
        ("src/spaced.ts", "git:b", spaced, &[Some("src/theme.ts")]),
    ];
    let answer = found(files, &[], &["."]);
    assert_eq!(said(&answer.declares[0].hits), vec!["src/closure.ts:2 run"]);
}
