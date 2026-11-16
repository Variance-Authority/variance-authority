//! Framing shared by revision reads and bounded object batches.

use std::io::BufRead;

/// What git said to one name.
pub(super) enum Reply {
    /// A submodule's commit comes as a `submodule` with no body, from a git
    /// new enough to say so. An older one answers `missing`.
    Object { oid: String, kind: String, body: Vec<u8> },
    /// Git holds nothing under this name. It says so alike for a path the tree
    /// does not list, a commit the store lacks, and a blob the tree names and
    /// the store lacks, so this alone settles none of them.
    Missing(String),
}

/// One answer of a `cat-file --batch`, read from `from`: `<name> missing`,
/// `<object> submodule`, or `<object> <type> <size>`, then the body and a newline.
pub(super) fn reply(from: &mut impl BufRead) -> Result<Reply, String> {
    match header(from)? {
        Header::Missing(name) => Ok(Reply::Missing(name)),
        Header::Object { oid, kind, size } => {
            let body = if kind == "submodule" { Vec::new() } else { body(from, size)? };
            Ok(Reply::Object { oid, kind, body })
        }
    }
}

pub(super) fn body(from: &mut impl BufRead, size: u64) -> Result<Vec<u8>, String> {
    let size = usize::try_from(size).ok().and_then(|size| size.checked_add(1)).ok_or("git object is too large to read")?;
    let mut body = vec![0; size];
    from.read_exact(&mut body).map_err(|_| "git cat-file --batch ended its answer early")?;
    if body.pop() != Some(b'\n') { return Err("git cat-file --batch omitted the body terminator".to_owned()); }
    Ok(body)
}

pub(super) enum Header {
    Object { oid: String, kind: String, size: u64 },
    Missing(String),
}

pub(super) fn header(from: &mut impl BufRead) -> Result<Header, String> {
    let cut = || "git cat-file --batch ended its answer early".to_owned();
    let mut head = Vec::new();
    from.read_until(b'\n', &mut head).map_err(|why| why.to_string())?;
    if head.pop() != Some(b'\n') {
        return Err(cut());
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    if let Some(name) = head.strip_suffix(" missing") {
        return Ok(Header::Missing(name.to_owned()));
    }
    let mut fields = head.split(' ');
    let (oid, kind, size) = (fields.next(), fields.next(), fields.next());
    let (Some(oid), Some(kind)) = (oid, kind) else {
        return Err(format!("git answered `{head}`"));
    };
    let size = if kind == "submodule" { 0 } else { size.and_then(|size| size.parse().ok()).ok_or_else(|| format!("git answered `{head}`"))? };
    Ok(Header::Object { oid: oid.to_owned(), kind: kind.to_owned(), size })
}
