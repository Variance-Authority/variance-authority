//! A text at a commit from a `git cat-file --batch` that stays open, so a read
//! costs a round trip on a pipe rather than a process.
//!
//! A selection asks for a path at a commit in jumps, and a reader that holds a
//! bounded amount of text asks git again for what it let go of. A process per
//! read made every one of those a cost of its own: 211,697 processes for 405
//! paths. Here a read starts none, so what a reader holds buys it an inflate
//! and a pipe, not a process.
//!
//! The name `<commit>:<path>` serves every commit from the one process, so a
//! turn between commits needs nothing here. There is one process, for the last
//! checkout asked at, rather than one a reader: a caller may build a reader a
//! file, and each would leave a child behind until something collected it. It
//! ends with its standard input, when this process does.
//!
//! This answers only what the name settles. A text, or a path the commit does
//! not hold at a commit the store has. Anything else is `None` and goes to
//! [`crate::commit_text`]'s read, which names git's reason: a commit this clone
//! lacks, a blob the tree names and the store does not, a git-LFS pointer, a
//! process that died. Those are the rare answers, so the processes they start
//! do not grow with the asks. A partial clone's blobs are fetched before the
//! asks, in one request, because git asked for each here makes a request apiece,
//! as `promisor.rs` describes.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, PoisonError};

use crate::commit_text::body_size;

/// The process, for whichever checkout was asked last.
static OPEN: Mutex<Option<Open>> = Mutex::new(None);

struct Open {
    root: String,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    /// The commits the store was seen to hold. A commit it lacks stays out, since a fetch can bring it.
    commits: HashSet<String>,
}

/// What git said to one name.
enum Reply {
    Object { kind: String, body: Vec<u8> },
    /// The name resolves to nothing: the tree does not list the path, or the store lacks the commit.
    Unresolved,
    /// The name resolves to an object the store lacks.
    Lacking,
}

/// `file` at `commit`: `Some(Some(bytes))` its blob, `Some(None)` a path the
/// commit does not hold, `None` when this cannot say and the read that names
/// the reason must.
pub(crate) fn blob_at(root: &str, commit: &str, file: &str) -> Option<Option<Vec<u8>>> {
    if commit.contains('\n') || file.contains('\n') {
        return None;
    }
    let mut slot = OPEN.lock().unwrap_or_else(PoisonError::into_inner);
    if !matches!(&*slot, Some(open) if open.root == root) {
        *slot = Open::start(root).ok();
    }
    let answered = slot.as_mut()?.answer(commit, file);
    answered.unwrap_or_else(|_| {
        *slot = None;
        None
    })
}

impl Open {
    fn start(root: &str) -> io::Result<Open> {
        let mut child = Command::new("git")
            .args(["cat-file", "--batch"])
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let (stdin, stdout) = (child.stdin.take(), child.stdout.take());
        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            return Err(io::ErrorKind::BrokenPipe.into());
        };
        Ok(Open { root: root.to_owned(), child, stdin, stdout: BufReader::new(stdout), commits: HashSet::new() })
    }

    fn answer(&mut self, commit: &str, file: &str) -> io::Result<Option<Option<Vec<u8>>>> {
        Ok(match self.ask(&format!("{commit}:{file}"))? {
            Reply::Object { kind, body } if kind == "blob" => (!crate::lfs::pointer(&body)).then_some(Some(body)),
            // A directory, or a submodule's commit: only a blob is a text.
            Reply::Object { .. } => Some(None),
            Reply::Unresolved => self.holds(commit)?.then_some(None),
            Reply::Lacking => None,
        })
    }

    fn holds(&mut self, commit: &str) -> io::Result<bool> {
        if self.commits.contains(commit) {
            return Ok(true);
        }
        let held = matches!(self.ask(&format!("{commit}^{{commit}}"))?, Reply::Object { .. });
        if held {
            self.commits.insert(commit.to_owned());
        }
        Ok(held)
    }

    /// One name out and its whole answer back, so neither pipe ever fills.
    fn ask(&mut self, name: &str) -> io::Result<Reply> {
        writeln!(self.stdin, "{name}")?;
        self.stdin.flush()?;
        let mut head = Vec::new();
        self.stdout.read_until(b'\n', &mut head)?;
        if head.pop() != Some(b'\n') {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        let head = String::from_utf8_lossy(&head);
        if head.strip_suffix(" missing") == Some(name) {
            return Ok(Reply::Unresolved);
        }
        if head.ends_with(" missing") {
            return Ok(Reply::Lacking);
        }
        // `<object> <type> <size>`, then the body and a newline.
        let (Some(size), Some(kind)) = (body_size(&head), head.split(' ').nth(1)) else {
            return Err(io::ErrorKind::InvalidData.into());
        };
        let mut body = vec![0; size + 1];
        self.stdout.read_exact(&mut body)?;
        body.pop();
        Ok(Reply::Object { kind: kind.to_owned(), body })
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_that_died_leaves_the_read_to_the_caller_and_the_next_one_a_new_process() {
        let root = std::env::temp_dir().join(format!("variance-text-session-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| crate::git::answer(root.to_str().unwrap(), args, None).unwrap();
        git(&["init", "--quiet"]);
        std::fs::write(root.join("a.ts"), "a").unwrap();
        git(&["add", "--all"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "--message", "a"]);
        let head = git(&["rev-parse", "HEAD"]);
        let commit = String::from_utf8_lossy(&head).trim().to_owned();
        let at = root.to_str().unwrap();

        assert_eq!(blob_at(at, &commit, "a.ts"), Some(Some(b"a".to_vec())));
        {
            let mut slot = OPEN.lock().unwrap();
            let open = slot.as_mut().unwrap();
            open.child.kill().unwrap();
            open.child.wait().unwrap();
        }

        assert_eq!(blob_at(at, &commit, "a.ts"), None);
        assert_eq!(blob_at(at, &commit, "a.ts"), Some(Some(b"a".to_vec())));
        assert_eq!(blob_at(at, &commit, "b.ts"), Some(None));
        *OPEN.lock().unwrap() = None;
        std::fs::remove_dir_all(&root).unwrap();
    }
}
