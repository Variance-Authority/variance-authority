//! Bounded raw-object batches on the persistent Git protocol owner.

use std::io::{self, BufReader, Write};
use std::process::ChildStdout;

use super::{header, Header, Open};
use super::object_reply::body;
use crate::git::Oid;

#[derive(Debug)]
pub(crate) enum PackedBlob {
    Bytes(Vec<u8>),
    Large(u64),
}

impl Open {
    /// Raw objects only: no replacements, filters, LFS smudging or lazy fetch.
    pub(crate) fn packed(root: &str) -> io::Result<Self> { Self::spawn(root, true) }

    /// Inspect sizes before requesting bodies, keeping one answer per object.
    pub(crate) fn blobs(&mut self, ids: &[Oid], limit: u64) -> Result<Vec<Result<PackedBlob, String>>, String> {
        if ids.is_empty() { return Ok(Vec::new()); }
        let names: Vec<String> = ids.iter().map(crate::git::hex).collect();
        let mut commands = String::new();
        for name in &names { commands.push_str(&format!("info {name}\n")); }
        commands.push_str("flush\n");
        let headers = self.exchange(commands, |from| names.iter().map(|_| header(from)).collect::<Result<Vec<_>, _>>())?;
        let mut found = Vec::with_capacity(ids.len());
        let mut bodies = Vec::new();
        let mut commands = String::new();
        for (at, (name, head)) in names.iter().zip(headers).enumerate() {
            match head {
                Header::Missing(missing) => found.push(Err(format!("git object {missing} is missing"))),
                Header::Object { oid, kind, size } => {
                    if oid != *name { return Err(format!("git answered object {oid} for {name}")); }
                    if kind != "blob" {
                        found.push(Err(format!("git object {name} is {kind}, not a blob")));
                    } else if size > limit {
                        found.push(Ok(PackedBlob::Large(size)));
                    } else {
                        found.push(Ok(PackedBlob::Large(size)));
                        bodies.push((at, size));
                        commands.push_str(&format!("contents {name}\n"));
                    }
                }
            }
        }
        if !bodies.is_empty() {
            commands.push_str("flush\n");
            self.exchange(commands, |from| {
                for &(at, size) in &bodies {
                    found[at] = match header(from)? {
                        Header::Missing(name) => Err(format!("git object {name} is missing")),
                        Header::Object { oid, kind, size: actual } if oid == names[at] && kind == "blob" && actual == size => Ok(PackedBlob::Bytes(body(from, size)?)),
                        Header::Object { oid, kind, .. } => return Err(format!("git answered {kind} {oid} with a different body for {}", names[at])),
                    };
                }
                Ok(())
            })?;
        }
        Ok(found)
    }

    /// Drain replies while sending: either pipe can exceed its OS buffer.
    fn exchange<T>(&mut self, commands: String, read: impl FnOnce(&mut BufReader<ChildStdout>) -> Result<T, String>) -> Result<T, String> {
        let Open { stdin, stdout, child, .. } = self;
        std::thread::scope(|scope| {
            let sent = scope.spawn(|| stdin.write_all(commands.as_bytes()).and_then(|()| stdin.flush()));
            let answer = read(stdout);
            if answer.is_err() { let _ = child.kill(); }
            let sent = sent.join().map_err(|_| "git object request writer stopped".to_owned())?;
            answer.and_then(|answer| sent.map(|()| answer).map_err(|why| why.to_string()))
        })
    }
}
