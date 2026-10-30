//! Paths at commits, as git holds them, for a reader that wants the text a
//! recording was cut from.
//!
//! One `cat-file --batch` answers every `<commit>:<path>`, so a window of a
//! selection costs one process. A path the commit does not hold is answered
//! `missing` and left out. In a partial clone a blob the clone has not fetched
//! is answered by a request of its own, so the blobs every path names are
//! fetched together first, as `promisor.rs` describes; if that fetch fails,
//! the read fetches them one at a time. A read git cannot finish fails with
//! git's own reason, never with a path answered missing that the commit holds.
//! A blob that is a git-LFS pointer is its content, or the read fails, as
//! `lfs.rs` describes.

// compass: variance-authority.reach.source-index

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
    let specs: Vec<(usize, &str)> =
        paths.iter().enumerate().flat_map(|(at, files)| files.iter().map(move |file| (at, file.as_str()))).collect();
    if specs.is_empty() {
        return Ok(found);
    }
    let unread = |why: &str| {
        let at: Vec<&str> = commits.iter().map(|commit| short(commit)).collect();
        format!("git could not read the files asked about at commit {}: {why}", at.join(", "))
    };
    let fetched = if crate::promisor::partial(root) {
        let oids: Vec<String> = commits.iter().zip(paths).flat_map(|(commit, files)| blobs(root, commit, files)).collect();
        crate::promisor::fetch(root, &oids)
    } else {
        Ok(())
    };
    let asked: String = specs.iter().map(|&(at, file)| format!("{}:{file}\n", commits[at])).collect();
    let out = answer(root, &["cat-file", "--batch"], Some(asked.into_bytes())).map_err(|why| match &fetched {
        Err(fetch) if fetch != &why => unread(&format!("{why} (the fetch before it: {fetch})")),
        _ => unread(&why),
    })?;

    let cut = || unread("git cat-file --batch ended its answer early");
    let mut from = 0;
    for (at, file) in specs {
        let end = from + out.get(from..).ok_or_else(cut)?.iter().position(|&byte| byte == b'\n').ok_or_else(cut)?;
        let head = String::from_utf8_lossy(&out[from..end]).into_owned();
        from = end + 1;
        // `<spec> missing` carries no size and no body.
        if head.ends_with(" missing") {
            continue;
        }
        // `<object> <type> <size>`, then the body and a newline.
        let mut fields = head.rsplitn(3, ' ');
        let size = fields.next().and_then(|size| size.parse::<usize>().ok()).ok_or_else(|| unread(&format!("git answered `{head}`")))?;
        let kind = fields.next();
        let body = out.get(from..from + size).ok_or_else(cut)?;
        from += size + 1;
        // A directory or a submodule at the path is no file's text.
        if kind != Some("blob") {
            continue;
        }
        let commit = &commits[at];
        let bytes = if crate::lfs::pointer(body) { crate::lfs::smudge(root, file, commit, body)? } else { body.to_vec() };
        found.commit.push(at as u32);
        found.file.push(file.to_owned());
        found.text.push(String::from_utf8_lossy(&bytes).into_owned());
    }
    Ok(found)
}

/// The blobs `commit`'s tree names at `files`. A partial clone holds the trees,
/// so listing them fetches nothing; a path the commit does not hold names none.
fn blobs(root: &str, commit: &str, files: &[String]) -> Vec<String> {
    let mut oids = Vec::new();
    for chunk in files.chunks(PATHS_PER_LISTING) {
        let mut args = vec!["--literal-pathspecs", "ls-tree", "-z", "--full-tree", commit, "--"];
        args.extend(chunk.iter().map(String::as_str));
        let Some(listed) = git(root, &args, None) else {
            continue;
        };
        // `<mode> <type> <object>\t<path>`, and only a blob is a text.
        for entry in listed.split(|byte| *byte == 0) {
            let head = entry.split(|byte| *byte == b'\t').next().unwrap_or_default();
            let mut fields = head.split(|byte| *byte == b' ').skip(1);
            if fields.next() == Some(b"blob".as_slice()) {
                oids.extend(fields.next().map(|oid| String::from_utf8_lossy(oid).into_owned()));
            }
        }
    }
    oids
}
