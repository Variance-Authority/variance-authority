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

pub(crate) fn excluded(name: &str) -> bool {
    EXCLUDED.contains(&name)
}
