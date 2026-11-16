//! The names an entry hands out, one rule of the reading to a test: what the
//! Help value documented when the scan's parses were read in JavaScript, now
//! read off the index.

use oxc_allocator::Allocator;

use super::{published_names, HelpEntry, PublishedName, ReachedDeclaration};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index::{parses_only, way};
use crate::read::{read_module, Read};

/// A file, its text, and the file each specifier it writes resolved to; a
/// specifier left out resolved to nothing.
type File<'a> = (&'a str, &'a str, &'a [(&'a str, &'a str)]);

/// A records layer holding each file with the targets of its requests, and a
/// parse layer read from each file's text: no file is on any disk.
fn chain(files: &[File]) -> (Vec<u8>, Vec<u8>) {
    let reads: Vec<(String, String, Read)> = files
        .iter()
        .enumerate()
        .map(|(at, (file, source, _))| {
            let digest = format!("git:{at:04x}");
            let read = read_module(file, source, &Allocator::default(), true);
            (digest, crate::parse_store::key(&format!("git:{at:04x}"), &way(file)), read)
        })
        .collect();
    let records: Vec<String> = files
        .iter()
        .zip(&reads)
        .map(|((file, _, resolved), (digest, _, read))| {
            let targets: Vec<String> = read
                .requests
                .iter()
                .map(|request| resolved.iter().find(|(value, _)| *value == request.value).map_or("null".to_owned(), |(_, to)| format!("\"{to}\"")))
                .collect();
            format!(r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": [{}]}}]"#, targets.join(", "))
        })
        .collect();
    let document = format!(r#"{{"records": [{}], "parses": [], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "));
    let mut rows: Vec<(&str, &Read)> = reads.iter().map(|(_, key, read)| (key.as_str(), read)).collect();
    rows.sort_unstable_by(|left, right| crate::order::code_unit(left.0, right.0));
    (merged(&[], &Delta::of(vec![document]).unwrap()), parses_only(&rows))
}

fn entry(key: &str, file: &str) -> HelpEntry {
    HelpEntry { key: key.to_owned(), file: file.to_owned() }
}

/// Each entry's names, read off `files`.
fn published(entries: &[HelpEntry], files: &[File]) -> Result<Vec<Vec<PublishedName>>, String> {
    let (records, parses) = chain(files);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    published_names(&layers, entries)
}

/// Each name the one entry `file` hands out, as `<name>: <kind> <at>:<line>`
/// for every kind it reads as, and ` as <declared>` where it is declared under
/// another name.
fn names_of(file: &str, files: &[File]) -> Vec<String> {
    let names = published(&[entry("example .", file)], files).unwrap();
    names[0]
        .iter()
        .flat_map(|published| {
            published.kinds.iter().map(|kind| {
                let renamed = if kind.declared == published.name { String::new() } else { format!(" as {}", kind.declared) };
                format!("{}: {} {}:{}{renamed}", published.name, kind.kind, kind.at, kind.line)
            })
        })
        .collect()
}

const LOGGER: File = ("logger.ts", "export default function logger(message: string): void {}\n", &[]);

#[test]
fn a_bare_specifier_goes_to_the_entry_the_workspace_opens_under_it() {
    let files: &[File] = &[
        ("app/index.ts", "export { helper } from 'lib';\nexport { deep } from 'lib/deep';\n", &[("lib", "lib/elsewhere.ts")]),
        ("lib/index.ts", "export function helper() {}\n", &[]),
        ("lib/elsewhere.ts", "export function helper() {}\n", &[]),
    ];
    let names = published(&[entry("app .", "app/index.ts"), entry("lib .", "lib/index.ts")], files).unwrap();
    let rows: Vec<(&str, &str, &str)> = names[0].iter().map(|name| (name.name.as_str(), name.kinds[0].kind.as_str(), name.kinds[0].at.as_str())).collect();
    // The graph's target is not read: the entry `lib .` is, and `lib ./deep` opens none.
    assert_eq!(rows, [("helper", "function", "lib/index.ts"), ("deep", "foreign", "app/index.ts")]);
}

#[test]
fn a_javascript_module_is_read_through_the_declaration_written_beside_it() {
    let files: &[File] = &[
        ("styles.ts", "export type { Theme } from './theme';\n", &[("./theme", "theme.js")]),
        ("theme.js", "export default function createTheme() {}\n", &[]),
        ("theme.d.ts", "export interface Theme {}\n", &[]),
    ];
    assert_eq!(names_of("styles.ts", files), ["Theme: interface theme.d.ts:1"]);
}

#[test]
fn a_javascript_module_with_no_declaration_beside_it_is_read_itself() {
    let files: &[File] = &[("entry.ts", "export { mjs } from './m.mjs';\n", &[("./m.mjs", "m.mjs")]), ("m.mjs", "export function mjs() {}\n", &[])];
    assert_eq!(names_of("entry.ts", files), ["mjs: function m.mjs:1"]);
    let typed: &[File] = &[
        ("entry.ts", "export { mjs } from './m.mjs';\n", &[("./m.mjs", "m.mjs")]),
        ("m.mjs", "export function mjs() {}\n", &[]),
        ("m.d.mts", "export declare function mjs(): void;\n", &[]),
    ];
    assert_eq!(names_of("entry.ts", typed), ["mjs: function m.d.mts:1"]);
}

#[test]
fn a_star_from_a_request_that_resolved_to_nothing_is_one_row_named_for_it() {
    let names = published(&[entry("example .", "entry.ts")], &[("entry.ts", "/** Everything. */\nexport * from './gone';\n", &[])]).unwrap();
    assert_eq!(names[0], [PublishedName {
        name: "* from './gone'".to_owned(),
        kinds: vec![ReachedDeclaration {
            kind: "namespace-object".to_owned(),
            at: "entry.ts".to_owned(),
            line: 2,
            signature: Some("export * from './gone'".to_owned()),
            doc: Some("Everything.".to_owned()),
            declared: "* from './gone'".to_owned(),
        }],
    }]);
}

#[test]
fn a_star_from_a_file_hands_out_every_name_it_does_default_among_them() {
    let files: &[File] = &[
        ("entry.ts", "export * from './all';\n", &[("./all", "all.ts")]),
        ("all.ts", "export const one = 1;\nexport default function two() {}\n", &[]),
    ];
    assert_eq!(names_of("entry.ts", files), ["one: const all.ts:1", "default: function all.ts:2"]);
}

#[test]
fn a_module_held_whole_is_a_namespace_object() {
    let files: &[File] = &[
        ("entry.ts", "export * as spread from './all';\nimport * as held from './all';\nexport { held };\nimport * as far from 'far';\nexport { far };\n", &[("./all", "all.ts")]),
        ("all.ts", "export const one = 1;\n", &[]),
    ];
    // The read writes `import * as held …; export { held }` as `export * as held from …`.
    assert_eq!(names_of("entry.ts", files), ["spread: namespace-object entry.ts:1", "held: namespace-object entry.ts:3", "far: namespace-object entry.ts:5"]);
    // An import held whole and exported by a name of this file is the same,
    // and so is one whose request resolved to no file: a namespace the
    // reading need not open.
    let bound: &[File] = &[
        ("entry.ts", "import * as held from './all';\nexport default held;\nimport * as far from 'far';\nexport { far as distant };\n", &[("./all", "all.ts")]),
        ("all.ts", "export const one = 1;\n", &[]),
    ];
    assert_eq!(names_of("entry.ts", bound), ["default: namespace-object entry.ts:2", "distant: namespace-object entry.ts:4"]);
}

#[test]
fn a_name_the_file_declares_is_its_declaration_and_is_not_followed() {
    // `tsc --declaration` writes this pair as `export default OriginalLogger`
    // and `export declare const logger: typeof OriginalLogger`.
    let pair = "import OriginalLogger from './logger';\nexport default OriginalLogger;\nexport const logger = OriginalLogger;\n";
    assert_eq!(names_of("pair.ts", &[("pair.ts", pair, &[("./logger", "logger.ts")]), LOGGER]), ["default: function logger.ts:1", "logger: const pair.ts:3"]);
}

#[test]
fn of_two_declarations_spelled_the_same_the_one_on_the_export_line_is_read() {
    let names = published(&[entry("handed .", "handed.js")], &[("handed.js", "function same() {}\nmodule.exports = function same(value) { return value; };\n", &[])]).unwrap();
    let default = &names[0].iter().find(|name| name.name == "default").unwrap().kinds[0];
    assert_eq!((default.kind.as_str(), default.line, default.signature.as_deref()), ("function", 2, Some("function same(value)")));
}

#[test]
fn an_anonymous_default_value_has_no_signature_invented_for_it() {
    let names = published(&[entry("literal .", "literal.ts")], &[("literal.ts", "export default 'example' as const;", &[])]).unwrap();
    let default = &names[0][0];
    assert_eq!((default.name.as_str(), default.kinds[0].kind.as_str(), default.kinds[0].at.as_str(), default.kinds[0].line), ("default", "const", "literal.ts", 1));
}

#[test]
fn an_import_exported_again_is_followed_to_its_declaration() {
    let commented = "import OriginalLogger from './logger';\nexport default /* the shared one */ OriginalLogger;\n";
    assert_eq!(names_of("commented.ts", &[("commented.ts", commented, &[("./logger", "logger.ts")]), LOGGER]), ["default: function logger.ts:1"]);
    let barrel: &[File] = &[
        ("entry.ts", "import { Public } from './barrel'; export default Public;", &[("./barrel", "barrel.ts")]),
        ("barrel.ts", "export { default as Public } from './value';", &[("./value", "value.ts")]),
        ("value.ts", "export default function Value() {}\nexport { Value };", &[]),
    ];
    assert_eq!(names_of("entry.ts", barrel), ["default: function value.ts:1"]);
}

#[test]
fn an_import_from_no_file_of_the_checkout_is_a_foreign_row() {
    // `unread.ts` resolved, and the index holds no parse of it.
    let files: &[File] = &[("entry.ts", "import far from 'far';\nexport default far;\nimport unread from './unread';\nexport { unread as later };\n", &[("./unread", "unread.ts")])];
    // The read writes `import unread …; export { unread as later }` as an
    // `export … from`, on the import's line.
    assert_eq!(names_of("entry.ts", files), ["default: foreign entry.ts:2", "later: foreign entry.ts:3"]);
    let names = published(&[entry("example .", "entry.ts")], files).unwrap();
    let signatures: Vec<Option<&str>> = names[0].iter().map(|name| name.kinds[0].signature.as_deref()).collect();
    assert_eq!(signatures, [Some("export default far"), Some("import unread from './unread'")]);
}

#[test]
fn a_name_bound_to_nothing_stops_the_reading() {
    let refused = published(&[entry("example .", "entry.ts")], &[("entry.ts", "export { nothing };\n", &[])]);
    assert_eq!(refused, Err("entry.ts exports `nothing`, and no declaration there says what it is".to_owned()));
}

#[test]
fn an_import_its_source_does_not_publish_stops_the_reading() {
    let source: File = ("all.ts", "export const one = 1;\n", &[]);
    let imported = published(&[entry("example .", "entry.ts")], &[("entry.ts", "import two from './all';\nexport default two;\n", &[("./all", "all.ts")]), source]);
    assert_eq!(imported, Err("entry.ts exports imported `default`, and its source does not publish it".to_owned()));
    let passed = published(&[entry("example .", "entry.ts")], &[("entry.ts", "export { two as three } from './all';\n", &[("./all", "all.ts")]), source]);
    assert_eq!(passed, Err("entry.ts re-exports `three` from `./all`, which does not publish it".to_owned()));
}

#[test]
fn the_kinds_of_a_name_merge_and_the_first_of_each_kind_is_kept() {
    let files: &[File] = &[
        ("entry.ts", "export interface Rate {}\nexport const Rate = 1;\nexport * from './a';\nexport * from './b';\n", &[("./a", "a.ts"), ("./b", "b.ts")]),
        ("a.ts", "export function shared() {}\n", &[]),
        ("b.ts", "export function shared() {}\nexport type shared = string;\n", &[]),
    ];
    assert_eq!(names_of("entry.ts", files), ["Rate: interface entry.ts:1", "Rate: const entry.ts:2", "shared: function a.ts:1", "shared: type b.ts:2"]);
}

#[test]
fn a_file_met_again_on_the_way_to_itself_hands_out_nothing_there() {
    let files: &[File] = &[
        ("a.ts", "export * from './b';\nexport const a = 1;\n", &[("./b", "b.ts")]),
        ("b.ts", "export * from './a';\nexport const b = 1;\n", &[("./a", "a.ts")]),
    ];
    let names = published(&[entry("a .", "a.ts"), entry("b .", "b.ts")], files).unwrap();
    let listed: Vec<Vec<&str>> = names.iter().map(|names| names.iter().map(|name| name.name.as_str()).collect()).collect();
    // `b.ts` was read while `a.ts` was, and keeps what it handed out then.
    assert_eq!(listed, [vec!["b", "a"], vec!["b"]]);
}
