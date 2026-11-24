//! Wait for the owner that is publishing the questions this command reads.

// compass: variance-authority.reach.source-index

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::thread;
use std::time::Duration;

use serde::Deserialize;

#[derive(Deserialize)]
struct Holder {
    pid: u32,
    log: String,
    failed: Option<Vec<String>>,
    readied: Option<bool>,
}

/// Follow the same lock the publisher writes and `settleFollowUps` reads.
/// Recovery of a failed or abandoned publication is still owned by Node.
pub(super) fn settled(index: &Path, waiting: impl FnOnce(&str)) -> Option<()> {
    wait_for(index, waiting, false)
}

pub(super) fn source_readied(index: &Path, waiting: impl FnOnce(&str)) -> Option<()> {
    wait_for(index, waiting, true)
}

fn wait_for(index: &Path, waiting: impl FnOnce(&str), source_only: bool) -> Option<()> {
    let path = format!("{}.follow-ups", index.to_str()?);
    let mut waiting = Some(waiting);
    loop {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Some(()),
            Err(_) => return None,
        };
        let holder: Holder = serde_json::from_slice(&bytes).ok()?;
        if holder.failed.is_some_and(|reasons| !reasons.is_empty()) || !alive(holder.pid) {
            return source_only.then_some(());
        }
        if source_only && holder.readied == Some(true) {
            return Some(());
        }
        if let Some(waiting) = waiting.take() {
            if source_only {
                waiting(&format!("waiting for process {} to fold the source index `variance index` left to it; its lines are in {}\n", holder.pid, holder.log));
            } else {
                waiting(&format!("waiting for process {} to finish the code map, the journeys, the dependency lexicon and the questions `variance index` left to it; its lines are in {}\n", holder.pid, holder.log));
            }
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else { return false };
    // Signal zero only checks whether a positive process ID exists.
    pid > 0
        && (unsafe { libc::kill(pid, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> RawHandle;
        fn WaitForSingleObject(handle: RawHandle, millis: u32) -> u32;
    }

    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 258;
    // Only SYNCHRONIZE is needed for a zero-timeout wait on the process.
    let raw = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
    if raw.is_null() {
        return std::io::Error::last_os_error().kind() == ErrorKind::PermissionDenied && pid != 0;
    }
    // OpenProcess returned a handle this invocation owns and must close.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
    (unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) }) == WAIT_TIMEOUT
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn alive(_: u32) -> bool {
    false
}

/// The same marker the Node and Rust readers check before opening a publication.
pub(super) struct Reservation {
    path: String,
    log: String,
}

impl Reservation {
    fn at(index: &str) -> Self {
        Self { path: format!("{index}.follow-ups"), log: format!("{index}.follow-ups.log") }
    }

    pub(super) fn log(&self) -> &str {
        &self.log
    }

    pub(super) fn received(index: &str) -> Result<Self, String> {
        let held = Self::at(index);
        if held.owner().is_some_and(|owner| owner.pid == std::process::id()) {
            Ok(held)
        } else {
            Err(format!("{} was not handed to process {}", held.path, std::process::id()))
        }
    }

    pub(super) fn hand_to(&self, pid: u32) -> Result<(), String> {
        if !self.owner().is_some_and(|owner| owner.pid == std::process::id()) {
            return Err(format!("{} is no longer held by process {}", self.path, std::process::id()));
        }
        crate::journey_output::replace(&self.path, &self.marker(pid, false, &[]))
    }

    pub(super) fn take(index: &str, waiting: &mut impl FnMut(&str)) -> Result<Self, String> {
        use std::io::Write;
        let held = Self::at(index);
        let failure = |error: std::io::Error| format!("{}: {error}", held.path);
        let parent = Path::new(index).parent().ok_or("the source index has no cache directory")?;
        fs::create_dir_all(parent).map_err(failure)?;
        let temporary = format!("{}.{}.reserve", held.path, std::process::id());
        let mut file = fs::File::options().write(true).create_new(true).open(&temporary).map_err(failure)?;
        let reserved = (|| {
            file.write_all(&held.marker(std::process::id(), false, &[])).map_err(failure)?;
            drop(file);
            let mut told = false;
            loop {
                match fs::hard_link(&temporary, &held.path) {
                    Ok(()) => return Ok(()),
                    Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(failure(error)),
                }
                if let Some(owner) = held.owner() {
                    if owner.failed.is_some_and(|failed| !failed.is_empty()) || !alive(owner.pid) {
                        held.release(owner.pid)?;
                        continue;
                    }
                    if !told {
                        waiting(&format!("waiting for process {} to finish the code map, the journeys, the dependency lexicon and the questions `variance index` left to it; its lines are in {}\n", owner.pid, owner.log));
                        told = true;
                    }
                } else if fs::metadata(&held.path)
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .is_some_and(|at| at.elapsed().is_ok_and(|age| age > Duration::from_secs(2)))
                {
                    return Err(format!("{} contains no readable follow-ups holder", held.path));
                }
                thread::sleep(Duration::from_millis(20));
            }
        })();
        let _ = fs::remove_file(temporary);
        reserved.map(|()| held)
    }

    pub(super) fn readied(&self) -> Result<(), String> {
        if self.owner().is_some_and(|owner| owner.pid == std::process::id()) {
            crate::journey_output::replace(&self.path, &self.marker(std::process::id(), true, &[]))?;
        }
        Ok(())
    }

    pub(super) fn finish(self, report: &str, failed: &[String]) -> Result<(), String> {
        crate::journey_output::replace(&self.log, report.as_bytes())?;
        if failed.is_empty() {
            self.release(std::process::id())
        } else if self.owner().is_some_and(|owner| owner.pid == std::process::id()) {
            crate::journey_output::replace(&self.path, &self.marker(std::process::id(), true, failed))
        } else {
            Ok(())
        }
    }

    fn owner(&self) -> Option<Holder> {
        serde_json::from_slice(&fs::read(&self.path).ok()?).ok()
    }

    fn release(&self, pid: u32) -> Result<(), String> {
        if self.owner().is_some_and(|owner| owner.pid == pid) {
            match fs::remove_file(&self.path) {
                Err(error) if error.kind() != ErrorKind::NotFound => return Err(format!("{}: {error}", self.path)),
                _ => {}
            }
        }
        Ok(())
    }

    fn marker(&self, pid: u32, readied: bool, failed: &[String]) -> Vec<u8> {
        let mut marker = serde_json::json!({ "pid": pid, "log": self.log });
        if readied {
            marker["readied"] = true.into();
        }
        if !failed.is_empty() {
            marker["failed"] = failed.into();
        }
        marker.to_string().into_bytes()
    }
}
