//! Repository path policy shared by discovery and resolution, and what a path
//! alone says of a file: its extension, the listed package it is in, and
//! whether it is a test.

use std::collections::HashSet;
use std::sync::LazyLock;

use napi_derive::napi;
use regex::{Regex, RegexBuilder};

const EXCLUDED: &[&str] = &[
    "node_modules",
    "dist",
    "tsDist",
    "build",
    "coverage",
    "storybook-static",
    ".git",
    ".next",
    ".turbo",
];

/// Whether a directory of this name is declined when nothing but the disk
/// says what is in it.
pub(crate) fn excluded(name: &str) -> bool {
    EXCLUDED.contains(&name)
}

/// Whether a directory of this name is declined even where Git lists what is
/// in it. `build` is the one excluded name that is not: a tracked `build/` can
/// itself be source (Docusaurus keeps its `build` command there, large
/// monorepos their build tooling), and Git identity is the evidence that the
/// path is intentional. The disk alone cannot tell it from generated output,
/// so without that evidence `build/` stays declined. The output directories
/// stay declined either way: what an import of them means is decided by the
/// configuration that emits them, not by whether they are committed.
pub(crate) fn excluded_when_listed(name: &str) -> bool {
    name != "build" && excluded(name)
}

/// `.ts` of `src/a.ts`; empty for a file with none, or whose name starts with its only `.`, as Node's `extname` says.
pub(crate) fn extension(file: &str) -> &str {
    let base = file.rsplit('/').next().unwrap_or(file);
    match base.rfind('.') {
        Some(0) | None => "",
        Some(at) => &base[at..],
    }
}

/// The basename and its whole suffix, starting at the first dot after the
/// initial character. A dotfile's leading dot belongs to its name.
pub(crate) fn name_and_suffix(file: &str) -> (&str, &str) {
    let name = file.rsplit('/').next().unwrap_or(file);
    let dot = name.char_indices().skip(1).find(|&(_, value)| value == '.').map_or(name.len(), |(at, _)| at);
    name.split_at(dot)
}

/// The deepest of `packages` over `file`, so a package nested in another owns
/// its own files, or `.` when none does.
pub(crate) fn package_owner<'a>(packages: &HashSet<String>, file: &'a str) -> &'a str {
    let mut end = file.len();
    while let Some(slash) = file[..end].rfind('/') {
        if slash == 0 {
            break;
        }
        if packages.contains(&file[..slash]) {
            return &file[..slash];
        }
        end = slash;
    }
    "."
}

/// A file named as a test, in any language.
const TEST_NAMED: &str = r"\.(test|spec|cy|e2e|stories|story)\.[cm]?[jt]sx?$|_test\.(go|py|[cm]?[jt]sx?)$|(^|/)test_[^/]+\.py$|_spec\.rb$|[a-z0-9]Tests?\.(java|kt)$";

/// A file in a folder only tests and what they are edited with are kept in, in any case.
const WITH_THE_TESTS: &str = r"(^|/)(__tests?__|__mocks__|__fixtures?__|__snapshots__|__stories__|\.storybook|fixtures|testdata|tests?|e2e|cypress)/";

static TESTS: LazyLock<(Regex, Regex)> = LazyLock::new(|| {
    (
        Regex::new(TEST_NAMED).expect("a test name pattern"),
        RegexBuilder::new(WITH_THE_TESTS).case_insensitive(true).build().expect("a test folder pattern"),
    )
});

/// Whether `file` is named as a test or sits with the tests, its fixtures and
/// snapshots included. Read a path inside a package from that package, so a
/// package named `test` is not its own test.
pub(crate) fn is_test_path(file: &str) -> bool {
    TESTS.0.is_match(file) || TESTS.1.is_match(file)
}

/// The two patterns [`is_test_path`] reads, for JavaScript to compile the same
/// test once rather than ask it per path: `named` as written, `withTheTests`
/// without case.
#[napi(object)]
pub struct TestPathPatterns {
    pub named: String,
    pub with_the_tests: String,
}

/// The patterns a path is read as a test by, the one place they are written.
#[napi]
pub fn test_path_patterns() -> TestPathPatterns {
    TestPathPatterns { named: TEST_NAMED.to_owned(), with_the_tests: WITH_THE_TESTS.to_owned() }
}
