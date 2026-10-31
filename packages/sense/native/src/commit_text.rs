//! Files at commits, as git holds them, for a reader that wants the text a
//! recording was cut from or a diff was taken against.
//!
//! [`contents`] reads blobs by object name: one `cat-file --batch` for all of
//! them, and in a partial clone one fetch first of those the clone lacks, as
//! `promisor.rs` describes. Every object it is handed was named by a tree, so
//! one git answers `missing` is a fault and never an absent file: the read
//! fails with git's own reason. A blob that is a git-LFS pointer is its
//! content, or the read fails, as `lfs.rs` describes.
//!
//! [`texts_at`] finds those object names in each commit's tree, so a path is
//! absent only when the tree does not list it. A commit the checkout does not
//! hold — a shallow clone, or one fetched at depth 1 — fails naming the
//! commit, never with every path answered absent.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use napi_derive::napi;

use crate::git::{answer, git};
use crate::journeys_graph::short;

/// Paths one `ls-tree` is handed, so the command line stays well under the
/// operating system's argument limit whatever the paths are.
const PATHS_PER_LISTING: usize = 512;

/// The texts found, as columns: `asked[commit[at]]` holds `file[at]` as `text[at]`.
#[napi(object)]
pub struct CommitTexts {
    pub commit: Vec<u32>,
    pub file: Vec<String>,
    pub text: Vec<String>,
}

/// `paths[at]` at `commits[at]`, leaving out a path the commit does not hold.
#[napi(catch_unwind)]
pub fn texts_at(root: String, commits: Vec<String>, paths: Vec<Vec<String>>) -> napi::Result<CommitTexts> {
    read(&root, &commits, &paths).map_err(napi::Error::from_reason)
}

pub(crate) fn read(root: &str, commits: &[String], paths: &[Vec<String>]) -> Result<CommitTexts, String> {
    let mut found = CommitTexts { commit: Vec::new(), file: Vec::new(), text: Vec::new() };
    let unread = |why: &str| {
        let at: Vec<&str> = commits.iter().map(|commit| short(commit)).collect();
        format!("git could not read the files asked about at commit {}: {why}", at.join(", "))
    };
    let mut held: Vec<(usize, &str, String)> = Vec::new();
    for (at, (commit, files)) in commits.iter().zip(paths).enumerate() {
        if files.is_empty() {
            continue;
        }
        let listed = blobs(root, commit, files).map_err(|why| absent(root, commit).unwrap_or_else(|| unread(&why)))?;
        held.extend(files.iter().filter_map(|file| listed.get(file).map(|oid| (at, file.as_str(), oid.clone()))));
    }
    let asked: Vec<Blob> = held.iter().map(|(at, file, oid)| Blob { oid, path: file, commit: &commits[*at] }).collect();
    let texts = contents(root, &asked).map_err(|why| unread(&why))?;
    for ((at, file, _), bytes) in held.iter().zip(texts) {
        found.commit.push(*at as u32);
        found.file.push((*file).to_owned());
        found.text.push(String::from_utf8_lossy(&bytes).into_owned());
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
    if blobs.is_empty() {
        return Ok(Vec::new());
    }
    let oids: Vec<&str> = blobs.iter().map(|blob| blob.oid).collect();
    let fetched = crate::promisor::fetch(root, &oids);
    let read = objects(root, &oids).map_err(|why| match &fetched {
        Err(fetch) if fetch != &why => format!("{why} (the fetch before it: {fetch})"),
        _ => why,
    })?;
    blobs
        .iter()
        .zip(read)
        .map(|(blob, body)| if crate::lfs::pointer(&body) { crate::lfs::smudge(root, blob.path, blob.commit, &body) } else { Ok(body) })
        .collect()
}

/// Why `commit` was not read when the checkout does not hold it, as a reason
/// that names the commit and how to fetch it, rather than what git failed to do
/// with it.
pub(crate) fn absent(root: &str, commit: &str) -> Option<String> {
    let known = git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")], None).is_some();
    (!known).then(|| {
        format!(
            "commit {} is not in this checkout's object store. \
             Fetch it with `git fetch origin {commit}`, or check out with `fetch-depth: 0`",
            short(commit)
        )
    })
}

/// Each of `oids` from one `cat-file --batch`, in order. An object git answers
/// `missing` is an error, as is any output that does not parse.
fn objects(root: &str, oids: &[&str]) -> Result<Vec<Vec<u8>>, String> {
    let asked: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let out = answer(root, &["cat-file", "--batch"], Some(asked.into_bytes()))?;
    let cut = || "git cat-file --batch ended its answer early".to_owned();
    let mut read = Vec::with_capacity(oids.len());
    let mut at = 0;
    for _ in oids {
        let end = at + out.get(at..).ok_or_else(cut)?.iter().position(|&byte| byte == b'\n').ok_or_else(cut)?;
        let head = String::from_utf8_lossy(&out[at..end]).into_owned();
        at = end + 1;
        // `<object> <type> <size>`, then the body and a newline.
        let size = match head.rsplit(' ').next().map(str::parse::<usize>) {
            Some(Ok(size)) if !head.ends_with(" missing") => size,
            _ => return Err(format!("git answered `{head}`")),
        };
        read.push(out.get(at..at + size).ok_or_else(cut)?.to_vec());
        at += size + 1;
    }
    Ok(read)
}

/// The blob `commit`'s tree names at each of `files` that is one. A path the
/// tree does not list, or lists as a directory or a submodule, names none. A
/// partial clone holds the trees, so listing them fetches nothing.
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
