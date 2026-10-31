//! Watchman, asked what moved: the change source spec 0107 puts beside git.
//!
//! The update holds the tree it was made against and the Watchman clock taken
//! before git listed it. Asked again, Watchman answers what changed since that
//! clock, and an empty answer from the same server over the same watch vouches
//! for the tree as held. Anything else — no server, another server, a fresh
//! instance, an error — is no answer, and the update asks git as it always did.
//!
//! The client only reads. It never starts a server (`--no-spawn`) and never
//! adds a watch: a checkout somebody already watches is the one this helps.

// compass: variance-authority.reach.source-index

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

/// The server, the watch that covers a root, and where that root sits in it.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Watch {
    pub socket: String,
    pub watched: String,
    /// The root below the watched one, or `None` when they are the same.
    pub relative: Option<String>,
    pub clock: String,
    /// `ignore_dirs` in the watch's configuration: paths Watchman never reports on.
    pub ignored: Vec<String>,
}

/// What Watchman says moved since a clock.
pub(crate) struct Since {
    /// The server has no history back to the clock: everything may have moved.
    pub fresh: bool,
    pub files: Vec<String>,
}

/// The socket a running server listens on: `$WATCHMAN_SOCK`, else what the CLI
/// names without starting one. `None` when no server runs.
pub(crate) fn socket() -> Option<String> {
    if let Some(socket) = std::env::var_os("WATCHMAN_SOCK") {
        return socket.into_string().ok();
    }
    let output = Command::new("watchman")
        .args(["--no-spawn", "--no-pretty", "get-sockname"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let answer: Value = serde_json::from_slice(&output.stdout).ok()?;
    answer.get("unix_domain").or_else(|| answer.get("sockname"))?.as_str().map(str::to_owned)
}

/// One command over a fresh connection, and its answer; `None` on any error.
fn ask(socket: &str, command: &Value) -> Option<Value> {
    let mut stream = UnixStream::connect(socket).ok()?;
    let mut line = serde_json::to_vec(command).ok()?;
    line.push(b'\n');
    stream.write_all(&line).ok()?;
    let mut answer = String::new();
    BufReader::new(stream).read_line(&mut answer).ok()?;
    let answer: Value = serde_json::from_str(&answer).ok()?;
    answer.get("error").is_none().then_some(answer)
}

/// The watch over `root` on the server at `socket`, at a clock taken now.
pub(crate) fn watch(socket: &str, root: &str) -> Option<Watch> {
    let roots = ask(socket, &json!(["watch-list"]))?;
    let watched = roots
        .get("roots")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .filter(|watched| root == *watched || root.strip_prefix(*watched).is_some_and(|rest| rest.starts_with('/')))
        .max_by_key(|watched| watched.len())?
        .to_owned();
    let relative = root.strip_prefix(&watched).map(|rest| rest.trim_start_matches('/')).filter(|rest| !rest.is_empty()).map(str::to_owned);
    let ignored = ask(socket, &json!(["get-config", watched]))
        .and_then(|config| config.pointer("/config/ignore_dirs").cloned())
        .and_then(|dirs| dirs.as_array().map(|dirs| dirs.iter().filter_map(Value::as_str).map(str::to_owned).collect()))
        .unwrap_or_default();
    let clock = ask(socket, &json!(["clock", watched, { "sync_timeout": 10_000 }]))?.get("clock")?.as_str()?.to_owned();
    Some(Watch { socket: socket.to_owned(), watched, relative, clock, ignored })
}

/// What moved below the watch's root since its clock, leaving out `excluded`,
/// a directory relative to that root whose writes are the update's own.
pub(crate) fn since(watch: &Watch, excluded: Option<&str>) -> Option<Since> {
    let mut query = json!({ "since": watch.clock, "fields": ["name"], "empty_on_fresh_instance": true });
    if let Some(relative) = &watch.relative {
        query["relative_root"] = json!(relative);
    }
    if let Some(excluded) = excluded {
        query["expression"] = json!(["not", ["dirname", excluded]]);
    }
    let answer = ask(&watch.socket, &json!(["query", watch.watched, query]))?;
    let fresh = answer.get("is_fresh_instance").and_then(Value::as_bool).unwrap_or(true);
    let files = answer
        .get("files")?
        .as_array()?
        .iter()
        .filter_map(|file| file.get("name").and_then(Value::as_str).or_else(|| file.as_str()))
        .map(str::to_owned)
        .collect();
    Some(Since { fresh, files })
}
