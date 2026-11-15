//! What `status` prints, for the repositories the in-process comparison in
//! `worktree_status` hands back: how git is asked about untracked files, and the
//! porcelain it answers with, read as the paths it names gone and edited.

// compass: variance-authority.reach.source-scan

use std::collections::HashMap;

use crate::git::{git, Moved};

/// What the repository configures about its untracked files: whether git keeps
/// an untracked cache, and `status.showUntrackedFiles`, the one mode it keeps it
/// for. `untrackedSettings` in `working-tree-changes.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UntrackedSettings {
    pub cached: bool,
    pub mode: &'static str,
}

/// The untracked settings and `worktree_status`'s, listed in one call; none set
/// is git's default, and so is a git that cannot answer.
pub(crate) fn configured(root: &str) -> Vec<u8> {
    let pattern = format!(r"^(core\.untrackedcache|feature\.manyfiles|status\.showuntrackedfiles|{})$", crate::worktree_status::KEYS);
    git(root, &["config", "-z", "--get-regexp", &pattern], None).unwrap_or_default()
}

/// `git config -z --get-regexp` output as the settings it names, read in
/// order so a later file wins, as git reads it. `settingsOf` in
/// `working-tree-changes.ts`.
pub(crate) fn settings_of(listed: &[u8]) -> UntrackedSettings {
    let truthy = |value: &[u8]| matches!(value, b"true" | b"yes" | b"on" | b"1");
    let falsy = |value: &[u8]| matches!(value, b"false" | b"no" | b"off" | b"0" | b"");
    let (mut cache, mut many_files, mut mode) = (None, false, "normal");
    for entry in listed.split(|byte| *byte == 0).filter(|entry| !entry.is_empty()) {
        // The key alone is a setting written with no value, which git reads as true.
        let (key, value) = match entry.iter().position(|byte| *byte == b'\n') {
            Some(newline) => (&entry[..newline], entry[newline + 1..].to_ascii_lowercase()),
            None => (entry, b"true".to_vec()),
        };
        match key {
            b"core.untrackedcache" => cache = Some(truthy(&value)),
            b"feature.manyfiles" => many_files = truthy(&value),
            b"status.showuntrackedfiles" => {
                mode = if value == b"all" { "all" } else if falsy(&value) { "no" } else { "normal" };
            }
            _ => {}
        }
    }
    UntrackedSettings { cached: cache.unwrap_or(many_files), mode }
}

/// How `status` is asked for the untracked files below `prefix`.
///
/// Git answers from its untracked cache only in the mode the repository
/// configures, and only with no pathspec, for the measurements
/// `untrackedQuestion` in `working-tree-changes.ts` gives. Where git keeps the
/// cache, the whole checkout is asked in its configured mode and the overlay
/// drops what lies beside the root; where it does not, the pathspec is what
/// keeps the walk to the root.
pub(crate) fn untracked_question(prefix: &[u8], settings: UntrackedSettings) -> Vec<&'static str> {
    if settings.cached && settings.mode != "no" {
        return vec![if settings.mode == "all" { "--untracked-files=all" } else { "--untracked-files=normal" }];
    }
    if prefix.is_empty() {
        vec!["--untracked-files=normal"]
    } else {
        vec!["--untracked-files=all", "--", "."]
    }
}

/// Porcelain status as the paths it names gone and the paths it names edited
/// or untracked, with the files under each directory it collapsed; `None` when
/// the walk under a collapsed directory did not answer.
pub(crate) fn porcelain(root: &str, prefix: &[u8], status: &[u8]) -> Option<(Moved, Vec<Vec<u8>>)> {
    let fields: Vec<&[u8]> = status.split(|byte| *byte == 0).collect();
    let mut moved: Moved = HashMap::new();
    let mut dirty: Vec<Vec<u8>> = Vec::new();
    let mut collapsed: Vec<&[u8]> = Vec::new();

    let mut at = 0;
    while at < fields.len() {
        let entry = fields[at];
        at += 1;
        if entry.len() < 4 {
            continue;
        }

        let codes = &entry[..2];

        // A rename carries its old path as the next field, and that path is gone.
        if codes.contains(&b'R') {
            if let Some(from) = fields.get(at).and_then(|from| from.strip_prefix(prefix)) {
                moved.insert(from.to_vec(), None);
            }
            at += 1;
        }
        // Collapsed by `normal`, the root itself, or a directory above it, is
        // one untracked line, and every file under the root is untracked.
        if codes == b"??" && entry.ends_with(b"/") && prefix.starts_with(&entry[3..]) {
            collapsed.push(b".");
            continue;
        }
        let Some(path) = entry[3..].strip_prefix(prefix) else {
            continue;
        };

        if codes.contains(&b'D') {
            moved.insert(path.to_vec(), None);
        } else if path.ends_with(b"/") {
            // A directory git did not descend: untracked, collapsed by
            // `--untracked-files=normal`, or a repository of its own. It has no
            // blob, and one in the batch fails `hash-object` for every file.
            if codes == b"??" {
                collapsed.push(path);
            }
        } else {
            dirty.push(path.to_vec());
        }
    }

    if !collapsed.is_empty() {
        // Only the directories git collapsed are walked, and the walk is git's,
        // so the ignore rules are the ones `status` applied. Unanswered, the
        // files under them are unknown, and git has not answered.
        let mut args = vec!["--literal-pathspecs", "ls-files", "-z", "--others", "--exclude-standard", "--"];
        let spelled: Option<Vec<&str>> = collapsed.iter().map(|dir| std::str::from_utf8(dir).ok()).collect();
        let listed = spelled.and_then(|dirs| {
            args.extend(dirs);
            git(root, &args, None)
        });
        let listed = listed?;
        for path in listed.split(|byte| *byte == 0) {
            if !path.is_empty() && !path.ends_with(b"/") {
                dirty.push(path.to_vec());
            }
        }
    }

    Some((moved, dirty))
}
