//! A blob git holds as a git-LFS pointer, and the content it stands for.
//!
//! Where `.gitattributes` sends a file to LFS, the blob in git is a pointer of
//! three lines and the content lives in the LFS store. A reader that takes the
//! blob as the file reads a text nobody wrote, so a pointer is either smudged
//! into its content or the read fails with git-lfs's own reason.

// compass: variance-authority.reach.source-index

use std::io::Write;
use std::process::{Command, Stdio};

/// First bytes of a pointer, per the git-lfs v1 pointer spec. The TypeScript
/// readers hold the same prefix in `@variance-authority/core`'s `lfs-pointer.ts`;
/// this is the one copy a second language forces.
const POINTER_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/";

/// Whether `bytes` are a git-LFS pointer rather than the file.
pub(crate) fn pointer(bytes: &[u8]) -> bool {
    bytes.starts_with(POINTER_PREFIX)
}

/// The content `blob`, a pointer for `path` at `commit`, stands for: `git lfs
/// smudge` answers from the local LFS store or fetches the object. When it
/// cannot — no git-lfs, an object the remote never had — the error says so in
/// git-lfs's words and names the commands that give it the content, never the
/// pointer as the text.
pub(crate) fn smudge(root: &str, path: &str, commit: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
    let refused = |why: &str| {
        format!(
            "{path} is a git-LFS pointer, and git-lfs could not give its content: {why}. \
             Run `git lfs install --local`, and `git lfs fetch origin {commit}` to fetch it."
        )
    };
    let mut child = Command::new("git")
        .args(["lfs", "smudge", "--", path])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| refused(&format!("git did not start: {error}")))?;
    // A pointer is a few hundred bytes, well under a pipe buffer.
    let written = child.stdin.take().map(|mut pipe| pipe.write_all(blob));
    let output = child.wait_with_output().map_err(|error| refused(&error.to_string()))?;
    if output.status.success() && matches!(written, Some(Ok(()))) {
        return Ok(output.stdout);
    }
    let said = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(refused(if said.is_empty() { "git lfs smudge ended without a reason" } else { &said }))
}
