//! Files at commits, as git holds them, for a reader that wants the text a
//! recording was cut from or a diff was taken against.
//!
//! [`each_content`] reads blobs by object name: one `cat-file --batch` for all
//! of them, and in a partial clone one fetch first of those the clone lacks, as
//! `promisor.rs` describes. Every object it is handed was named by a tree, so
//! one git answers `missing` is a fault and never an absent file: that blob
//! carries git's own reason. A blob that is a git-LFS pointer is its content,
//! or carries git-lfs's reason, as `lfs.rs` describes. [`contents`] is the same
//! read for a caller that needs every blob, failing on the first reason.
//!
//! [`texts_at`] finds those object names in each commit's tree, so a path is
//! absent only when the tree does not list it. A path git could not read is
//! refused with git's reason beside the texts it could: a commit the checkout
//! does not hold — a shallow clone, or one fetched at depth 1 — refuses each
//! path asked at it naming the commit, never with every path answered absent.
//! [`blobs_at`] is the same listing without the bodies: each path's blob name,
//! `git:<object>`, for a reader that only asks whether two commits hold the
//! same text.
//!
//! [`text_at`] is one path at one commit, for a reader that asks them one at a
//! time and again, in jumps, and asks again for what it let go of. A process per
//! read made each of those a cost of its own: 211,697 processes for 405 paths.
//! So [`blob_at`] answers from a `git cat-file --batch` that stays open: a text
//! or an absent path costs a round trip on a pipe, and holding one buys a reader
//! an inflate and a pipe, not a process.
//!
//! The name `<commit>:<path>` serves every commit from the one process, so a
//! turn between commits needs nothing there. There is one process, for the last
//! checkout asked at, rather than one a reader: a caller may build a reader a
//! file, and each would leave a child behind until something collected it. It
//! ends with its standard input, when this process does.
//!
//! Git answers `missing` alike for a path the tree does not list and a blob it
//! lists and the store lacks, so a path is absent only when the tree that would
//! list it does not, read from the same process. It answers only what that
//! settles. Anything else goes to [`read`], which names git's reason: a commit this clone lacks, a blob the tree names and the
//! store does not, a git-LFS pointer, a process that died. `cat-file` gives a
//! pointer's text, and its content takes `git lfs smudge`. That read starts
//! processes every time it runs: two for a commit the store lacks, about sixteen
//! for a pointer, nearly all of them `git lfs smudge`'s. A reader spares a
//! pointer's content while it holds it, and nothing spares a refused read, which
//! is held nowhere. [`fetch_texts_at`] is what such a reader does first in a
//! partial clone, because git asked for each blob makes a request apiece, as
//! `promisor.rs` describes.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, PoisonError};

use napi_derive::napi;

use crate::git::{answer, git};
use crate::journeys_graph::short;

/// Paths one `ls-tree` is handed, so the command line stays well under the
/// operating system's argument limit whatever the paths are.
const PATHS_PER_LISTING: usize = 512;

/// The texts found, as columns: `asked[commit[at]]` holds `file[at]` as
/// `text[at]`. Beside them, the paths git could not read: `asked[refused_commit[at]]`
/// holds `refused_file[at]`, and `refused[at]` is git's reason.
#[napi(object)]
pub struct CommitTexts {
    pub commit: Vec<u32>,
    pub file: Vec<String>,
    pub text: Vec<String>,
    pub refused_commit: Vec<u32>,
    pub refused_file: Vec<String>,
    pub refused: Vec<String>,
}

/// `paths[at]` at `commits[at]`, leaving out a path the commit does not hold,
/// and refusing one git could not read with its reason.
#[napi(catch_unwind)]
pub fn texts_at(root: String, commits: Vec<String>, paths: Vec<Vec<String>>) -> napi::Result<CommitTexts> {
    read(&root, &commits, &paths).map_err(napi::Error::from_reason)
}

/// `file` at `commit`, `None` a path the commit does not hold, and an error
/// carrying git's reason for one it could not read.
#[napi(catch_unwind)]
pub fn text_at(root: String, commit: String, file: String) -> napi::Result<Option<String>> {
    if let Some(found) = blob_at(&root, &commit, &file) {
        return Ok(found.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()));
    }
    let mut found = read(&root, &[commit], &[vec![file]]).map_err(napi::Error::from_reason)?;
    match found.refused.pop() {
        Some(why) => Err(napi::Error::from_reason(why)),
        None => Ok(found.text.pop()),
    }
}

/// In a partial clone, fetch the blobs `commit` names at `files` in one request.
/// Nothing to do in any other clone. A fetch that failed is not reported: the
/// read of a text it left behind gives git's reason.
#[napi(catch_unwind)]
pub fn fetch_texts_at(root: String, commit: String, files: Vec<String>) {
    if crate::promisor::promised(&root).is_none() {
        return;
    }
    if let Ok(named) = blobs(&root, &commit, &files) {
        let oids: Vec<&str> = named.values().map(String::as_str).collect();
        let _ = crate::promisor::fetch(&root, &oids);
    }
}

/// The blob name, `git:<object>`, of `paths[at]` at `commits[at]`, in the
/// columns [`texts_at`] answers in: a path the commit does not hold is left
/// out, and a commit git could not list refuses each path asked at it.
#[napi(catch_unwind)]
pub fn blobs_at(root: String, commits: Vec<String>, paths: Vec<Vec<String>>) -> CommitTexts {
    let mut found = empty();
    for (at, file, oid) in listed(&root, &commits, &paths, &mut found) {
        found.commit.push(at as u32);
        found.file.push(file.to_owned());
        found.text.push(format!("git:{oid}"));
    }
    found
}

/// The blob each of `paths[at]` names in `commits[at]`'s tree, as `(at, path,
/// object)`, leaving out a path the tree does not list. A commit git could not
/// list refuses each path asked at it into `found`.
fn listed<'a>(root: &str, commits: &[String], paths: &'a [Vec<String>], found: &mut CommitTexts) -> Vec<(usize, &'a str, String)> {
    let mut held = Vec::new();
    for (at, (commit, files)) in commits.iter().zip(paths).enumerate() {
        if files.is_empty() {
            continue;
        }
        match blobs(root, commit, files) {
            Ok(listed) => held.extend(files.iter().filter_map(|file| listed.get(file).map(|oid| (at, file.as_str(), oid.clone())))),
            Err(why) => {
                let why = absent(root, commit).unwrap_or_else(|| unread(&[commit], &why));
                for file in files {
                    found.refused_commit.push(at as u32);
                    found.refused_file.push(file.clone());
                    found.refused.push(why.clone());
                }
            }
        }
    }
    held
}

fn empty() -> CommitTexts {
    CommitTexts {
        commit: Vec::new(),
        file: Vec::new(),
        text: Vec::new(),
        refused_commit: Vec::new(),
        refused_file: Vec::new(),
        refused: Vec::new(),
    }
}

fn unread(commits: &[&String], why: &str) -> String {
    let at: Vec<&str> = commits.iter().map(|commit| short(commit)).collect();
    format!("git could not read the files asked about at commit {}: {why}", at.join(", "))
}

pub(crate) fn read(root: &str, commits: &[String], paths: &[Vec<String>]) -> Result<CommitTexts, String> {
    let mut found = empty();
    let held = listed(root, commits, paths, &mut found);
    let asked: Vec<Blob> = held.iter().map(|(at, file, oid)| Blob { oid, path: file, commit: &commits[*at] }).collect();
    let every: Vec<&String> = commits.iter().collect();
    let texts = each_content(root, &asked).map_err(|why| unread(&every, &why))?;
    for ((at, file, _), body) in held.iter().zip(texts) {
        match body {
            Ok(bytes) => {
                found.commit.push(*at as u32);
                found.file.push((*file).to_owned());
                found.text.push(String::from_utf8_lossy(&bytes).into_owned());
            }
            Err(why) => {
                found.refused_commit.push(*at as u32);
                found.refused_file.push((*file).to_owned());
                found.refused.push(unread(&[&commits[*at]], &why));
            }
        }
    }
    Ok(found)
}

/// A blob to read, and where it stands, for the pointer a smudge is handed.
pub(crate) struct Blob<'a> {
    pub(crate) oid: &'a str,
    pub(crate) path: &'a str,
    pub(crate) commit: &'a str,
}

/// Each of `blobs`, in order, as the file it stands for, or git's reason for
/// not reading one of them.
pub(crate) fn contents(root: &str, blobs: &[Blob]) -> Result<Vec<Vec<u8>>, String> {
    each_content(root, blobs)?.into_iter().collect()
}

/// Each of `blobs`, in order, as the file it stands for or git's reason for
/// not reading that one. The outer error is a read that answered nothing.
pub(crate) fn each_content(root: &str, blobs: &[Blob]) -> Result<Vec<Result<Vec<u8>, String>>, String> {
    if blobs.is_empty() {
        return Ok(Vec::new());
    }
    let oids: Vec<&str> = blobs.iter().map(|blob| blob.oid).collect();
    let fetched = crate::promisor::fetch(root, &oids);
    let after_fetch = |why: String| match &fetched {
        Err(fetch) if fetch != &why => format!("{why} (the fetch before it: {fetch})"),
        _ => why,
    };
    let read = objects(root, &oids).map_err(after_fetch)?;
    Ok(blobs
        .iter()
        .zip(read)
        .map(|(blob, body)| match body {
            Ok(body) if crate::lfs::pointer(&body) => crate::lfs::smudge(root, blob.path, blob.commit, &body),
            Ok(body) => Ok(body),
            Err(why) => Err(after_fetch(why)),
        })
        .collect())
}

/// Why `commit` was not read when the checkout does not hold it, for a reader
/// in TypeScript that names the gap: [`absent`].
#[napi(catch_unwind)]
pub fn commit_absent(root: String, commit: String) -> Option<String> {
    absent(&root, &commit)
}

/// Why `commit` was not read when the checkout does not hold it, as a reason
/// that names the commit and how to fetch it, rather than what git failed to do
/// with it.
pub(crate) fn absent(root: &str, commit: &str) -> Option<String> {
    let known = git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")], None).is_some();
    (!known).then(|| {
        format!(
            "commit {} is not in this checkout's object store. \
             Fetch it with `git fetch origin {commit}`, or check out every commit: \
             `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`",
            short(commit)
        )
    })
}

/// Each of `oids` from one `cat-file --batch`, in order. An object git answers
/// `missing` is that object's error; output that does not parse fails the read.
fn objects(root: &str, oids: &[&str]) -> Result<Vec<Result<Vec<u8>, String>>, String> {
    let asked: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let out = answer(root, &["cat-file", "--batch"], Some(asked.into_bytes()))?;
    let mut rest = out.as_slice();
    let mut read = Vec::with_capacity(oids.len());
    for _ in oids {
        read.push(match reply(&mut rest)? {
            Reply::Object { body, .. } => Ok(body),
            Reply::Missing(name) => Err(format!("git answered `{name} missing`")),
        });
    }
    Ok(read)
}

/// What git said to one name.
enum Reply {
    /// A submodule's commit comes as a `submodule` with no body.
    Object { oid: String, kind: String, body: Vec<u8> },
    /// Git holds nothing under this name. It says so alike for a path the tree
    /// does not list, a commit the store lacks, and a blob the tree names and
    /// the store lacks, so this alone settles none of them.
    Missing(String),
}

/// One answer of a `cat-file --batch`, read from `from`: `<name> missing`,
/// `<object> submodule`, or `<object> <type> <size>`, then the body and a newline.
fn reply(from: &mut impl BufRead) -> Result<Reply, String> {
    let cut = || "git cat-file --batch ended its answer early".to_owned();
    let mut head = Vec::new();
    from.read_until(b'\n', &mut head).map_err(|why| why.to_string())?;
    if head.pop() != Some(b'\n') {
        return Err(cut());
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    if let Some(name) = head.strip_suffix(" missing") {
        return Ok(Reply::Missing(name.to_owned()));
    }
    let mut fields = head.split(' ');
    let (oid, kind, size) = (fields.next(), fields.next(), fields.next());
    let (Some(oid), Some(kind)) = (oid, kind) else {
        return Err(format!("git answered `{head}`"));
    };
    let mut body = Vec::new();
    if kind != "submodule" {
        let Some(size) = size.and_then(|size| size.parse::<usize>().ok()) else {
            return Err(format!("git answered `{head}`"));
        };
        body.resize(size + 1, 0);
        from.read_exact(&mut body).map_err(|_| cut())?;
        body.pop();
    }
    Ok(Reply::Object { oid: oid.to_owned(), kind: kind.to_owned(), body })
}

/// The blob `commit`'s tree names at each of `files` that is one. A path the
/// tree does not list, or lists as a directory or a submodule, names none. A
/// blobless clone holds the trees, so listing them fetches nothing; a treeless
/// one fetches them as git's lazy fetch does.
fn blobs(root: &str, commit: &str, files: &[String]) -> Result<HashMap<String, String>, String> {
    let mut oids = HashMap::new();
    for chunk in files.chunks(PATHS_PER_LISTING) {
        let mut args = vec!["--literal-pathspecs", "ls-tree", "-z", "--full-tree", commit, "--"];
        args.extend(chunk.iter().map(String::as_str));
        let listed = answer(root, &args, None)?;
        // `<mode> <type> <object>\t<path>`, and only a blob is a text.
        for entry in listed.split(|byte| *byte == 0) {
            let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
                continue;
            };
            let mut fields = entry[..tab].split(|byte| *byte == b' ').skip(1);
            if fields.next() == Some(b"blob".as_slice()) {
                if let Some(oid) = fields.next() {
                    oids.insert(String::from_utf8_lossy(&entry[tab + 1..]).into_owned(), String::from_utf8_lossy(oid).into_owned());
                }
            }
        }
    }
    Ok(oids)
}

/// The process, for whichever checkout was asked last.
static OPEN: Mutex<Option<Open>> = Mutex::new(None);

struct Open {
    root: String,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// `file` at `commit`: `Some(Some(bytes))` its blob, `Some(None)` a path the
/// commit does not hold, `None` when this cannot say and the read that names
/// the reason must.
pub(crate) fn blob_at(root: &str, commit: &str, file: &str) -> Option<Option<Vec<u8>>> {
    // Git reads a name that starts so against the working directory, and it is no path in a tree.
    if commit.contains('\n') || file.contains('\n') || file.starts_with("./") || file.starts_with("../") {
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
        Ok(Open { root: root.to_owned(), child, stdin, stdout: BufReader::new(stdout) })
    }

    fn answer(&mut self, commit: &str, file: &str) -> Result<Option<Option<Vec<u8>>>, String> {
        Ok(match self.ask(&format!("{commit}:{file}"))? {
            Reply::Object { kind, body, .. } if kind == "blob" => (!crate::lfs::pointer(&body)).then_some(Some(body)),
            // A directory, or a submodule's commit: only a blob is a text.
            Reply::Object { .. } => Some(None),
            Reply::Missing(_) => self.unlisted(commit, file)?.then_some(None),
        })
    }

    /// Whether `commit`'s tree holds nothing at `path`, read from the tree that
    /// would list it. False for a path it lists, and when that tree cannot be
    /// read, a commit the store lacks included.
    fn unlisted(&mut self, commit: &str, path: &str) -> Result<bool, String> {
        let (parent, name) = path.rsplit_once('/').map_or((None, path), |(parent, name)| (Some(parent), name));
        let tree = parent.map_or_else(|| format!("{commit}^{{tree}}"), |parent| format!("{commit}:{parent}"));
        match (self.ask(&tree)?, parent) {
            (Reply::Object { oid, kind, body }, _) if kind == "tree" => Ok(!lists(&body, name, oid.len() / 2)),
            (Reply::Object { .. }, _) => Ok(true),
            (Reply::Missing(_), Some(parent)) => self.unlisted(commit, parent),
            (Reply::Missing(_), None) => Ok(false),
        }
    }

    /// One name out and its whole answer back, so neither pipe ever fills.
    fn ask(&mut self, name: &str) -> Result<Reply, String> {
        writeln!(self.stdin, "{name}").and_then(|()| self.stdin.flush()).map_err(|why| why.to_string())?;
        reply(&mut self.stdout)
    }
}

/// Whether `tree`, a tree object's body of `<mode> <name>\0<object>` entries
/// with objects of `width` bytes, lists `name`.
fn lists(tree: &[u8], name: &str, width: usize) -> bool {
    let mut rest = tree;
    while let Some(end) = rest.iter().position(|byte| *byte == 0) {
        let entry = &rest[..end];
        if entry.iter().position(|byte| *byte == b' ').is_some_and(|space| &entry[space + 1..] == name.as_bytes()) {
            return true;
        }
        rest = rest.get(end + 1 + width..).unwrap_or_default();
    }
    false
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
