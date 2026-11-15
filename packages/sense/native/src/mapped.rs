//! A segment's bytes, mapped read-only from its file on macOS and Linux.
//!
//! A question opens the whole chain and reads a few rows of it: on Kibana the
//! chain is a quarter of a gigabyte, and copying it into the heap before the
//! first row was read cost each question more than the rows did. A mapping
//! costs the pages a reading touches. A segment is never written in place: the
//! log renames each into place under its digest and removes it by name, so a
//! mapping keeps the bytes it opened even after a writer published past them.
//!
//! Elsewhere, and for an empty file, which cannot be mapped, the bytes are read.

// compass: variance-authority.reach.source-index

use std::ops::Deref;

pub(crate) struct Mapped {
    held: Held,
}

enum Held {
    Read(Vec<u8>),
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    Mapped { at: *const u8, length: usize },
}

// The mapping is read-only and private, and unmapped only when this is dropped.
unsafe impl Send for Mapped {}
unsafe impl Sync for Mapped {}

impl Mapped {
    /// The bytes of the file at `path`.
    pub(crate) fn open(path: &str) -> std::io::Result<Self> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            use std::os::fd::AsRawFd;
            let file = std::fs::File::open(path)?;
            let length = file.metadata()?.len() as usize;
            if length == 0 {
                return Ok(Self::from(Vec::new()));
            }
            // SAFETY: a fresh read-only mapping of a file this process opened;
            // the descriptor may close once the mapping exists.
            let at = unsafe { libc::mmap(std::ptr::null_mut(), length, libc::PROT_READ, libc::MAP_PRIVATE, file.as_raw_fd(), 0) };
            if at == libc::MAP_FAILED {
                return Err(std::io::Error::last_os_error());
            }
            Ok(Self { held: Held::Mapped { at: at.cast(), length } })
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            std::fs::read(path).map(Self::from)
        }
    }
}

impl From<Vec<u8>> for Mapped {
    fn from(bytes: Vec<u8>) -> Self {
        Self { held: Held::Read(bytes) }
    }
}

impl Deref for Mapped {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match &self.held {
            Held::Read(bytes) => bytes,
            // SAFETY: the mapping lives as long as `self` and is never written.
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            Held::Mapped { at, length } => unsafe { std::slice::from_raw_parts(*at, *length) },
        }
    }
}

impl Drop for Mapped {
    fn drop(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Held::Mapped { at, length } = self.held {
            // SAFETY: unmapped once, by the owner of the mapping.
            unsafe { libc::munmap(at as *mut libc::c_void, length) };
        }
    }
}

impl PartialEq<Vec<u8>> for Mapped {
    fn eq(&self, other: &Vec<u8>) -> bool {
        **self == **other
    }
}

impl std::fmt::Debug for Mapped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "Mapped({} bytes)", self.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mapping_keeps_the_bytes_it_opened_after_the_file_is_replaced() {
        let directory = std::env::temp_dir().join(format!("va-mapped-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("segment.bin");
        std::fs::write(&path, b"first").unwrap();
        let mapped = Mapped::open(path.to_str().unwrap()).unwrap();
        let next = directory.join("next.bin");
        std::fs::write(&next, b"second").unwrap();
        std::fs::rename(&next, &path).unwrap();
        assert_eq!(&*mapped, b"first");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(&*mapped, b"first");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn an_empty_file_is_empty_bytes() {
        let directory = std::env::temp_dir().join(format!("va-mapped-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("empty.bin");
        std::fs::write(&path, b"").unwrap();
        assert!(Mapped::open(path.to_str().unwrap()).unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
