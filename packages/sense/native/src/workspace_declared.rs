//! Whether the root of a checkout declares workspaces, which is what keeps it
//! the container of the code map rather than a package on it.
//!
//! The rule is `members` in `packages/package/src/members.ts`: a list with an
//! entry under `workspaces` in the root manifest, as an array or as yarn's
//! `{ packages }`, or else under `packages:` in a `pnpm-workspace.yaml` beside
//! it. An empty list and a file of settings alone declare none, and neither
//! does a `lerna.json`, which `members` does not read.
//!
//! This answers one bit of that rule and lists no member, so it stops where
//! `members` goes on. It refuses nothing either: a declaration `members` refuses
//! is still a declaration, and the fold of a checkout is no place to say so. The
//! file is read by its lines rather than parsed, for one bit no YAML crate is
//! worth: a key at the start of a line, quoted or not, then a block list at any
//! indent or a flow list. A document written as one flow mapping declares none
//! here.

// compass: variance-authority.reach.relations

use std::path::Path;

use serde_json::Value;

/// Whether the manifest and `pnpm-workspace.yaml` at `root` declare a member.
pub(crate) fn declares_workspaces(root: &str) -> bool {
    let root = Path::new(root);
    let manifest = std::fs::read(root.join("package.json")).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    manifest.is_some_and(|manifest| manifest_lists(&manifest))
        || std::fs::read_to_string(root.join("pnpm-workspace.yaml")).is_ok_and(|text| pnpm_lists(&text))
}

/// Whether `workspaces` holds an entry, or anything `members` would refuse.
fn manifest_lists(manifest: &Value) -> bool {
    let listed = match manifest.get("workspaces") {
        Some(Value::Object(field)) => field.get("packages"),
        field => field,
    };
    match listed {
        None | Some(Value::Null) => false,
        Some(Value::Array(entries)) => !entries.is_empty(),
        Some(_) => true,
    }
}

/// Whether `packages:` holds an entry, or anything `members` would refuse.
fn pnpm_lists(text: &str) -> bool {
    let mut lines = text.strip_prefix('\u{feff}').unwrap_or(text).lines();
    let Some(inline) = lines.by_ref().find_map(after_key) else { return false };
    let mut rest = lines.map(uncommented).filter(|line| !line.trim().is_empty());
    let value = match uncommented(inline).trim() {
        "" => rest.next().filter(|line| belongs_to_key(line)).map_or("", str::trim),
        value => value,
    };
    match value.strip_prefix('[') {
        Some(inside) => {
            let first = std::iter::once(inside).chain(rest).map(str::trim).find(|part| !part.is_empty());
            first.is_some_and(|part| !part.starts_with(']'))
        }
        None => !matches!(value, "" | "~" | "null" | "Null" | "NULL"),
    }
}

/// What follows `packages:` on a line that opens with that key.
fn after_key(line: &str) -> Option<&str> {
    let after = ["packages", "\"packages\"", "'packages'"].iter().find_map(|key| line.strip_prefix(key))?;
    let value = after.trim_start().strip_prefix(':')?;
    (value.is_empty() || value.starts_with([' ', '\t'])).then_some(value)
}

/// Whether the line after an empty key is its value: indented, or a list item
/// at the key's own indent. Anything else at the margin is the next key.
fn belongs_to_key(line: &str) -> bool {
    line.starts_with([' ', '\t']) || line.trim_end() == "-" || line.starts_with("- ")
}

/// `line` up to a comment: a `#` opening it, or following a space.
fn uncommented(line: &str) -> &str {
    let at = line.match_indices('#').find(|&(at, _)| at == 0 || line[..at].ends_with([' ', '\t']));
    at.map_or(line, |(at, _)| &line[..at])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_declares_what_members_reads_an_entry_from() {
        for (field, declared) in [
            (r#"{}"#, false),
            (r#"{"workspaces": null}"#, false),
            (r#"{"workspaces": []}"#, false),
            (r#"{"workspaces": {"packages": []}}"#, false),
            (r#"{"workspaces": {"nohoist": ["a"]}}"#, false),
            (r#"{"workspaces": ["packages/*"]}"#, true),
            (r#"{"workspaces": {"packages": ["packages/*"]}}"#, true),
            (r#"{"workspaces": "packages/*"}"#, true),
        ] {
            assert_eq!(manifest_lists(&serde_json::from_str(field).unwrap()), declared, "{field}");
        }
    }

    #[test]
    fn a_pnpm_file_declares_what_members_reads_an_entry_from() {
        for (text, declared) in [
            ("", false),
            ("# packages:\n#   - a\n", false),
            ("onlyBuiltDependencies:\n  - esbuild\n", false),
            ("catalog:\n  packages: 1\n", false),
            ("packages-extra:\n  - a\n", false),
            ("packages:\n", false),
            ("packages: # none yet\nonlyBuiltDependencies:\n  - esbuild\n", false),
            ("packages: []\n", false),
            ("packages: [ ] # none\n", false),
            ("packages: [\n]\n", false),
            ("packages:\n  []\n", false),
            ("packages: null\n", false),
            ("packages: ~\n", false),
            ("packages:\n  - packages/*\n", true),
            ("packages:\n- packages/*\n", true),
            ("packages:\r\n  - packages/*\r\n", true),
            ("packages: # the members\n  # first\n  - packages/*\n", true),
            ("\u{feff}packages:\n  - packages/*\n", true),
            ("\"packages\":\n  - packages/*\n", true),
            ("'packages' :\n  - packages/*\n", true),
            ("packages: [packages/*]\n", true),
            ("packages: [\n  packages/*,\n]\n", true),
            ("onlyBuiltDependencies:\n  - esbuild\npackages:\n  - packages/*\n", true),
            ("packages: packages/*\n", true),
        ] {
            assert_eq!(pnpm_lists(text), declared, "{text:?}");
        }
    }
}
