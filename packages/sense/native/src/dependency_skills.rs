//! The agent skills an installed package ships, read once when the lexicon is refreshed.
//!
//! A skill is a directory holding a `SKILL.md` whose front matter names it and
//! says when to use it. A package ships its skills in `skills/` beside its
//! manifest, the layout TanStack Intent set for npm. They are recorded where
//! they are, with what the front matter says; nothing is installed or copied,
//! and a question reads them back without opening the package. A skill kept
//! anywhere else is one the package installs with its own command, and is not read.

// compass: variance-authority.report.agent-surface

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{relative, Identity};

/// The Agent Skills format caps a description at this many characters; a longer one is cut there.
const DESCRIPTION: usize = 1024;

/// One `skills/<directory>/SKILL.md`: its name, where it is, and what it says it is for, or why it did not read.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Skill {
    pub name: String,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unreadable: Option<String>,
}

/// A YAML scalar as a skill's front matter writes one: plain, quoted, or a `>`/`|` block, folded to one line.
fn scalar(first: &str, rest: &[&str]) -> String {
    let first = first.trim();
    let folded = |lines: &[&str]| lines.iter().map(|line| line.trim()).filter(|line| !line.is_empty()).collect::<Vec<_>>().join(" ");
    if first.starts_with('>') || first.starts_with('|') { return folded(rest); }
    let text = if rest.is_empty() { first.to_owned() } else { format!("{first} {}", folded(rest)) };
    let quoted = |quote: char| text.len() >= 2 && text.starts_with(quote) && text.ends_with(quote);
    if quoted('"') { return text[1..text.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\"); }
    if quoted('\'') { return text[1..text.len() - 1].replace("''", "'"); }
    text
}

/// `name` and `description` from the front matter between the opening `---` and the next; none when it never closes.
fn front(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim_end) != Some("---") { return (None, None); }
    let lines: Vec<&str> = lines.collect();
    let Some(end) = lines.iter().position(|line| line.trim_end() == "---") else { return (None, None) };
    let block = &lines[..end];
    let value = |key: &str| {
        let start = block.iter().position(|line| line.strip_prefix(key).is_some_and(|rest| rest.starts_with(':')))?;
        let first = &block[start][key.len() + 1..];
        let rest: Vec<&str> = block[start + 1..].iter().take_while(|line| line.is_empty() || line.starts_with([' ', '\t'])).copied().collect();
        let value = scalar(first, &rest).split_whitespace().collect::<Vec<_>>().join(" ");
        (!value.is_empty()).then_some(value)
    };
    (value("name"), value("description").map(|text| text.chars().take(DESCRIPTION).collect()))
}

/// The skills under `skills/` beside the runtime package's manifest (or its declarations'), by directory in code-unit order;
/// a `SKILL.md` that resolves outside the package is not read.
pub(super) fn skills(root: &Path, runtime: &Option<Identity>, declarations: &Option<Identity>) -> Option<Vec<Skill>> {
    let identity = runtime.as_ref().or(declarations.as_ref())?;
    let package = root.join(&identity.manifest).parent()?.to_path_buf();
    // A link may stay inside the package; one that leaves it reads a file the package did not ship.
    let inside = package.canonicalize().ok()?;
    let mut found: Vec<Skill> = fs::read_dir(package.join("skills")).ok()?.filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir() || kind.is_symlink()))
        .filter_map(|entry| {
            let path = entry.path().join("SKILL.md");
            if !path.canonicalize().is_ok_and(|real| real.starts_with(&inside) && real.is_file()) { return None; }
            let folder = entry.file_name().to_string_lossy().into_owned();
            let at = relative(root, &path);
            Some(match fs::read_to_string(&path) {
                Ok(text) => {
                    let (name, description) = front(&text);
                    Skill { name: name.unwrap_or(folder), at, description, unreadable: None }
                }
                Err(error) => Skill { name: folder, at, description: None, unreadable: Some(error.to_string()) },
            })
        })
        .collect();
    found.sort_by(|a, b| a.at.cmp(&b.at));
    (!found.is_empty()).then_some(found)
}

#[cfg(test)]
mod tests {
    use super::front;

    #[test]
    fn reads_plain_quoted_and_block_scalars() {
        assert_eq!(front("---\nname: a\ndescription: Plain words.\n---\n"), (Some("a".into()), Some("Plain words.".into())));
        assert_eq!(front("---\nname: 'b'\ndescription: \"Say \\\"it\\\".\"\n---\n"), (Some("b".into()), Some("Say \"it\".".into())));
        assert_eq!(front("---\ndescription: >-\n  One\n  two.\nname: c\n---\n"), (Some("c".into()), Some("One two.".into())));
        assert_eq!(front("---\ndescription: |\n  Kept\n\n  apart.\n---\n").1, Some("Kept apart.".into()));
        assert_eq!(front("---\ndescription: starts here\n  and goes on.\n---\n").1, Some("starts here and goes on.".into()));
        assert_eq!(front("\u{feff}---\nname: d\n---\n").0, Some("d".into()));
        assert_eq!(front(&format!("---\ndescription: {}\n---\n", "x".repeat(1100))).1.map(|text| text.len()), Some(1024));
    }

    #[test]
    fn reads_nothing_without_front_matter_or_past_it() {
        assert_eq!(front("# Title\nname: x\n"), (None, None));
        assert_eq!(front("---\nlicense: MIT\n---\nname: x\n"), (None, None));
        assert_eq!(front("---\nmetadata:\n  name: nested\n---\n"), (None, None));
        assert_eq!(front("---\nname: open\ndescription: never closed\n# Body\n"), (None, None));
    }
}
