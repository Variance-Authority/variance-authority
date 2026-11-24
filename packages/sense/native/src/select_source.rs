//! Bring selection's source graph up to the checkout before a skip is issued.

// compass: variance-authority.reach.source-index

use std::path::Path;

use crate::change_tree::change_tree;
use crate::index_chain::OpenedChain;
use crate::resolve::Tsconfig;
use crate::source_query::{RuntimeTree, SourceTree};
use crate::source_tree::{self, Mocking};

/// Use the merge base and working tree, as the journey has no commit of its own.
/// A moved install or untracked additions require their own readers.
pub(super) fn diff_since(root: &Path, since: &str) -> Option<String> {
    let git = |args: &[&str]| crate::git::git(root.to_str()?, args, None);
    let base = git(&["merge-base", "--end-of-options", since, "HEAD"])?;
    let base = std::str::from_utf8(&base).ok()?.trim();
    for file in ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json"] {
        if !root.join(file).try_exists().ok()? {
            continue;
        }
        if git(&["rev-parse", "--verify", &format!("{base}:{file}")])?
            != git(&["hash-object", "--no-filters", "--", file])?
        {
            return None;
        }
        break;
    }
    if !git(&["ls-files", "--others", "--exclude-standard", "-z"])?.is_empty() {
        return None;
    }
    let patch = git(&[
        "-c",
        "core.quotePath=false",
        "-c",
        "diff.noprefix=false",
        "-c",
        "diff.mnemonicPrefix=false",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        base,
        "--",
    ])?;
    String::from_utf8(patch).ok()
}

pub(super) fn refresh(root: &Path, no_git: bool, tsconfig: Tsconfig) -> Option<RuntimeTree> {
    let index = super::super::source_index(root)?;
    let index = index.to_str()?;
    let root = root.to_str()?;
    let tree = change_tree(root.to_owned(), index.to_owned(), vec![".".to_owned()])?;
    use super::super::source::{self as index_source, Reuse};
    let updated = index_source::refresh(&tree, root, index, &tsconfig, no_git, Reuse::default())?.ok()?;
    if updated.refused.is_some() || updated.files == 0 {
        return None;
    }
    let chain = OpenedChain::read(index).ok()??;
    let mocking = Mocking::at(root, tsconfig.clone(), super::super::source::code_extensions());
    let tree = SourceTree::read(&source_tree::tree(chain.layers(), &mocking), "").ok()?;
    let cuts = source_tree::mock_cuts(chain.layers(), root, tsconfig);
    Some(RuntimeTree::new(tree, &cuts))
}

/// Capture staged, unstaged and untracked files in one tree, without touching
/// the repository's index or leaving objects in its store.
pub(super) fn recorded_diff(root: &Path, commit: &str) -> Option<String> {
    use std::fs::{self, File, FileTimes};
    use std::process::{Command, Stdio};

    let root_text = root.to_str()?;
    let git_path = |name: &str| {
        let bytes = crate::git::git(root_text, &["rev-parse", "--path-format=absolute", "--git-path", name], None)?;
        Some(root.join(std::str::from_utf8(&bytes).ok()?.trim_end_matches(['\r', '\n'])))
    };
    let real_index = git_path("index")?;
    let real_objects = git_path("objects")?;
    let scratch = tempfile::Builder::new().prefix("variance-tree-").tempdir().ok()?;
    let objects = scratch.path().join("objects");
    let index = scratch.path().join("index");
    let stamp = fs::metadata(&real_index).ok()?;
    fs::create_dir(&objects).ok()?;
    fs::copy(real_index, &index).ok()?;
    File::options()
        .write(true)
        .open(&index)
        .ok()?
        .set_times(FileTimes::new().set_accessed(stamp.accessed().ok()?).set_modified(stamp.modified().ok()?))
        .ok()?;
    let inherited = std::env::var_os("GIT_ALTERNATE_OBJECT_DIRECTORIES");
    let alternate = |first: &Path| {
        std::env::join_paths(
            std::iter::once(first.to_owned()).chain(inherited.as_ref().into_iter().flat_map(std::env::split_paths)),
        )
        .ok()
    };
    let writing = alternate(&real_objects)?;
    let borrowing = alternate(&objects)?;
    let git = |args: &[&str], write: bool| {
        let mut command = Command::new("git");
        command.current_dir(root).args(args).stdin(Stdio::null());
        if write {
            command.env("GIT_INDEX_FILE", &index).env("GIT_OBJECT_DIRECTORY", &objects);
        }
        let out =
            command.env("GIT_ALTERNATE_OBJECT_DIRECTORIES", if write { &writing } else { &borrowing }).output().ok()?;
        out.status.success().then_some(out.stdout)
    };
    git(&["add", "-A"], true)?;
    let tree = git(&["write-tree"], true)?;
    let tree = std::str::from_utf8(&tree).ok()?.trim();
    String::from_utf8(git(
        &[
            "-c",
            "core.quotePath=false",
            "-c",
            "diff.noprefix=false",
            "-c",
            "diff.mnemonicPrefix=false",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-U0",
            commit,
            tree,
            "--",
        ],
        false,
    )?)
    .ok()
}
