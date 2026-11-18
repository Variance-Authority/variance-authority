//! `where a JVM import lands` in `jvm.test.ts`, case for case.

use std::collections::HashMap;

use super::resolve;
use crate::world::World;

/// Read, because a source root is derived from what a file says its package is.
const FILES: [(&str, &str); 5] = [
    ("src/main/java/a/b/Thing.java", "package a.b;\npublic class Thing {}\n"),
    ("src/main/java/a/b/Other.java", "package a.b;\nclass Other {}\n"),
    ("src/main/java/a/c/Far.java", "package a.c;\nclass Far {}\n"),
    ("src/test/java/a/b/ThingTest.java", "package a.b;\nclass ThingTest {}\n"),
    ("src/main/kotlin/a/b/helpers.kt", "package a.b\n\nfun parse() {}\n"),
];

fn landed(from: &str, request: &str) -> Vec<String> {
    let held: HashMap<&str, &str> = FILES.iter().copied().collect();
    let known: HashMap<String, u32> = FILES.iter().map(|(path, _)| (*path).to_owned()).zip(0..).collect();
    let parsing = |paths: &[&str]| paths.iter().map(|_| None).collect();
    let texting = |path: &str| held.get(path).map(|text| (*text).to_owned());
    let world = World::new(Some(&known), None).reading(&parsing, &texting);
    resolve(&world, from, request)
}

#[test]
fn derives_the_source_root_from_what_the_file_says_its_package_is() {
    assert_eq!(landed("src/main/java/a/c/Far.java", "a.b.Thing"), ["src/main/java/a/b/Thing.java"]);
}

#[test]
fn unions_the_roots_so_a_test_reaches_the_class_it_tests() {
    assert_eq!(
        landed("src/test/java/a/b/ThingTest.java", "a.b.*"),
        ["src/main/java/a/b/Other.java", "src/main/java/a/b/Thing.java", "src/main/kotlin/a/b/helpers.kt"]
    );
}

#[test]
fn stops_at_the_file_when_a_segment_left_over_is_a_name_inside_it() {
    assert_eq!(landed("src/main/java/a/c/Far.java", "a.b.Thing.Inner"), ["src/main/java/a/b/Thing.java"]);
}

#[test]
fn falls_back_to_the_package_when_a_kotlin_name_is_not_a_filename() {
    assert_eq!(landed("src/main/java/a/c/Far.java", "a.b.parse"), ["src/main/kotlin/a/b/helpers.kt"]);
}

#[test]
fn is_silent_about_the_platform_and_the_dependency_graph() {
    assert!(landed("src/main/java/a/b/Thing.java", "java.util.List").is_empty());
}

/// Not a case of its own in `jvm.test.ts`: `packageOf`'s pattern, line-anchored and ASCII.
#[test]
fn reads_a_package_only_at_the_start_of_a_line() {
    let package = |text: &str| super::PACKAGE.captures(text).and_then(|found| found.get(1)).map(|name| name.as_str().to_owned());
    assert_eq!(package("// x\r\n  package a.b_c;\n").as_deref(), Some("a.b_c"));
    assert_eq!(package("x package a.b;\n"), None);
    assert_eq!(package("package\na.b;\n"), None);
}
