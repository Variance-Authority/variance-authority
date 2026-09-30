//! One source index's heavy work at a time on a machine.
//!
//! An update and its follow-ups each spread over every core, so two of them at
//! once — two checkouts, or a worktree beside its primary — do not finish
//! twice as late but later still, each starving the other of the cache and the
//! memory bandwidth it was sized for. So the work takes a turn: an exclusive
//! lock on one file every index on the machine names, which the kernel lets go
//! when its process ends however it ends, so a crashed holder never strands
//! the next one. `index-turn.ts` waits for it, and says whom it waits on.

// compass: variance-authority.reach.source-index

use std::fs::{self, File, TryLockError};
use std::io::Write;

use napi_derive::napi;

/// A turn held; it ends when released, or when this process does.
#[napi]
pub struct IndexTurn {
    lock: Option<File>,
}

#[napi]
impl IndexTurn {
    #[napi]
    pub fn release(&mut self) {
        self.lock = None;
    }
}

/// The turn at `path` when no process holds it, with `holder` written beside
/// it at `<path>.holder` for a process that waits to name; `None` while
/// another holds it. The holder is a file of its own because a locked range
/// cannot be read on every platform.
#[napi(catch_unwind)]
pub fn take_index_turn(path: String, holder: String) -> napi::Result<Option<IndexTurn>> {
    let fail = |error: std::io::Error| napi::Error::from_reason(format!("{path}: {error}"));
    let lock = File::options().create(true).truncate(false).write(true).open(&path).map_err(fail)?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Ok(None),
        Err(TryLockError::Error(error)) => return Err(fail(error)),
    }
    // A crashed process with this id may have left its file behind; a new one
    // is created rather than an existing path opened, so nothing is followed.
    let written = format!("{path}.holder.{}.tmp", std::process::id());
    match fs::remove_file(&written) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(fail(error)),
        _ => {}
    }
    let mut file = File::options().write(true).create_new(true).open(&written).map_err(fail)?;
    file.write_all(holder.as_bytes()).map_err(fail)?;
    fs::rename(&written, format!("{path}.holder")).map_err(fail)?;
    Ok(Some(IndexTurn { lock: Some(lock) }))
}
