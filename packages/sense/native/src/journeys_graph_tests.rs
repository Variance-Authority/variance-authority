use std::path::Path;
use std::process::Command;

use super::*;

fn git(at: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "user.email=test@example.test", "-c", "user.name=Test", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(at)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn graph(files: &[(&str, &str)]) -> Graph {
    let mut graph = Graph {
        files: Vec::new(),
        ids: HashMap::new(),
        parsed: Vec::new(),
        specs: Vec::new(),
        targets: Vec::new(),
        calls_from: Vec::new(),
        fell_back: 0,
        tree: None,
    };
    for (file, text) in files {
        let id = graph.intern(file);
        graph.parsed[id as usize] = parse(file, text);
    }
    for id in 0..files.len() {
        let parsed = graph.parsed[id].as_ref().unwrap();
        let mut specs: Vec<String> = parsed.imports.values().map(|import| import.spec.clone()).collect();
        specs.extend(parsed.star.iter().cloned());
        specs.extend(parsed.exports.values().filter_map(|export| match export {
            Export::From { spec, .. } => Some(spec.clone()),
            Export::Local(_) => None,
        }));
        let map = specs
            .into_iter()
            .map(|spec| {
                let to = graph.ids.get(&format!("{}.ts", spec.trim_start_matches("./"))).copied();
                (spec, to)
            })
            .collect();
        graph.specs[id] = map;
    }
    graph
}

#[test]
fn an_import_is_followed_through_a_barrel_to_its_declaration() {
    let graph = graph(&[
        ("a.ts", "import { run } from './barrel';\nimport * as ns from './barrel';\nimport { value } from './c';\nrun();\nns.run();\nvalue();\nother.run();\nmissing();\n"),
        ("barrel.ts", "export * from './b';\n"),
        ("b.ts", "export function run() {}\n"),
        ("c.ts", "export const value = make();\n"),
    ]);
    let parsed = graph.parsed(0).unwrap();
    let targets: Vec<Target> = parsed.calls.iter().map(|call| graph.target_of(0, call.from, &call.callee, call.callback)).collect();
    assert!(matches!(targets[0], Target::Fn { file: 2, func: 0, how: How::Import }));
    assert!(matches!(targets[1], Target::Fn { file: 2, func: 0, how: How::Namespace }));
    assert!(matches!(&targets[2], Target::NotFunction { file: 3, local } if local == "value"));
    assert!(matches!(targets[3], Target::Member));
    assert!(matches!(targets[4], Target::Free));
}

#[test]
fn an_export_star_fan_out_routes_a_name_only_to_the_file_that_declares_it() {
    let graph = graph(&[
        ("a.ts", "import { second, nowhere } from './barrel';\nsecond();\nnowhere();\n"),
        ("barrel.ts", "export * from './b';\nexport * from './c';\n"),
        ("b.ts", "export function first() {}\n"),
        ("c.ts", "export function second() {}\n"),
    ]);
    let parsed = graph.parsed(0).unwrap();
    let targets: Vec<Target> = parsed.calls.iter().map(|call| graph.target_of(0, call.from, &call.callee, call.callback)).collect();
    assert!(matches!(targets[0], Target::Fn { file: 3, func: 0, how: How::Import }));
    assert!(!matches!(targets[1], Target::Fn { .. } | Target::NotFunction { .. }), "a name no star target declares reaches no file");
}

#[test]
fn a_local_name_resolves_to_the_declaration_whose_scope_holds_the_call() {
    let graph = graph(&[("a.ts", "function f() {}\nfunction g() {\n  function f() {}\n  f();\n}\nf();\n")]);
    let parsed = graph.parsed(0).unwrap();
    let inner = parsed.calls.iter().find(|call| call.from == Some(1)).unwrap();
    let outer = parsed.calls.iter().find(|call| call.from.is_none()).unwrap();
    assert!(matches!(graph.target_of(0, inner.from, &inner.callee, None), Target::Fn { func: 2, .. }));
    assert!(matches!(graph.target_of(0, outer.from, &outer.callee, None), Target::Fn { func: 0, .. }));
}

#[test]
fn a_file_moved_since_the_commit_is_read_under_the_path_the_commit_had() {
    let root = std::env::temp_dir().join(format!("sense-journeys-moved-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    let text: String = (1..=50).map(|line| format!("export function f{line}() {{}}\n")).collect();
    std::fs::write(root.join("a.ts"), &text).unwrap();
    std::fs::write(root.join("notes.md"), "one\n").unwrap();
    git(&root, &["init", "--quiet"]);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "-m", "a"]);
    let recorded = git(&root, &["rev-parse", "HEAD"]);
    git(&root, &["mv", "a.ts", "b.ts"]);
    std::fs::write(root.join("notes.md"), "two\n").unwrap();
    git(&root, &["commit", "--quiet", "-am", "b"]);

    let then = text_at(root.to_str().unwrap(), &recorded).unwrap();
    assert_eq!(then.get("a.ts"), Some(&Some(text)));
    assert_eq!(then.get("b.ts"), Some(&None));
    assert!(!then.contains_key("notes.md"), "only source files are read from the commit");

    let missing = text_at(root.to_str().unwrap(), "0123456789abcdef0123456789abcdef01234567").unwrap_err();
    assert_eq!(missing, "commit 0123456789ab is not in this checkout's object store");
    std::fs::remove_dir_all(&root).unwrap();
}

/// A clone of a five-file history made with `--filter=<filter>`, holding only
/// what its checkout needed, so the five texts at the first commit are on the
/// server alone. The server's `upload-pack` appends a line to `requests` for
/// every request it answers; with `refuse_first`, it refuses the first one made
/// after the clone.
#[cfg(unix)]
fn partial_clone(name: &str, filter: &str, refuse_first: bool) -> (std::path::PathBuf, String, std::path::PathBuf, String) {
    use std::os::unix::fs::PermissionsExt;
    let base = std::env::temp_dir().join(format!("sense-journeys-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let (source, clone) = (base.join("source"), base.join("clone"));
    std::fs::create_dir_all(&source).unwrap();
    let base = std::fs::canonicalize(base).unwrap();
    let text = |at: usize, then: bool| format!("export const at{at} = {};\n", if then { at + 1 } else { (at + 1) * 10 });
    for at in 0..5 {
        std::fs::write(source.join(format!("f{at}.ts")), text(at, true)).unwrap();
    }
    git(&source, &["init", "--quiet"]);
    git(&source, &["config", "uploadpack.allowFilter", "true"]);
    git(&source, &["config", "uploadpack.allowAnySHA1InWant", "true"]);
    git(&source, &["add", "-A"]);
    git(&source, &["commit", "--quiet", "-m", "then"]);
    let then = git(&source, &["rev-parse", "HEAD"]);
    for at in 0..5 {
        std::fs::write(source.join(format!("f{at}.ts")), text(at, false)).unwrap();
    }
    git(&source, &["commit", "--quiet", "-am", "now"]);

    let requests = base.join("requests");
    let serve = base.join("serve");
    let refuse = if refuse_first { "[ \"$(wc -l < \"$log\")\" -eq 1 ] && exit 1\n" } else { "" };
    let script = format!("#!/bin/sh\nlog='{}'\necho request >> \"$log\"\n{refuse}exec git upload-pack \"$@\"\n", requests.display());
    std::fs::write(&serve, script).unwrap();
    std::fs::set_permissions(&serve, std::fs::Permissions::from_mode(0o755)).unwrap();
    let url = format!("file://{}", base.join("source").display());
    git(&base, &["clone", "--quiet", &format!("--filter={filter}"), &url, clone.to_str().unwrap()]);
    git(&clone, &["config", "remote.origin.uploadpack", serve.to_str().unwrap()]);
    std::fs::write(&requests, "").unwrap();
    let expected = (0..5).map(|at| text(at, true)).collect::<Vec<_>>().join("");
    (clone, then, requests, expected)
}

#[cfg(unix)]
fn read_in_order(texts: &HashMap<String, Option<String>>) -> String {
    (0..5).map(|at| texts[&format!("f{at}.ts")].clone().unwrap_or_default()).collect()
}

#[cfg(unix)]
#[test]
fn a_partial_clone_fetches_the_texts_at_the_commit_in_one_request() {
    let (clone, then, requests, expected) = partial_clone("prefetch", "blob:none", false);
    let texts = text_at(clone.to_str().unwrap(), &then).unwrap();
    assert_eq!(read_in_order(&texts), expected);
    assert_eq!(std::fs::read_to_string(&requests).unwrap().lines().count(), 1, "one request for five blobs");
    std::fs::remove_dir_all(clone.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn a_refused_prefetch_still_reads_every_text_one_request_at_a_time() {
    let (clone, then, requests, expected) = partial_clone("refused", "blob:none", true);
    let texts = text_at(clone.to_str().unwrap(), &then).unwrap();
    assert_eq!(read_in_order(&texts), expected, "a failed prefetch is not a missing text");
    assert_eq!(std::fs::read_to_string(&requests).unwrap().lines().count(), 6, "the refused request, then one per blob");
    std::fs::remove_dir_all(clone.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn a_treeless_clone_fetches_the_trees_and_then_the_texts_in_two_requests() {
    let (clone, then, requests, expected) = partial_clone("treeless", "tree:0", false);
    let texts = text_at(clone.to_str().unwrap(), &then).unwrap();
    assert_eq!(read_in_order(&texts), expected);
    assert_eq!(std::fs::read_to_string(&requests).unwrap().lines().count(), 2, "one request for the trees, one for the blobs");
    std::fs::remove_dir_all(clone.parent().unwrap()).unwrap();
}
