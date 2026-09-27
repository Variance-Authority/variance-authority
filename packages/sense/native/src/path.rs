//! Repository path policy shared by discovery and resolution.

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
