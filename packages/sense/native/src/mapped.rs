//! A segment's bytes, mapped read-only from its file.
//!
//! A question opens the whole chain and reads a few rows of it: on Kibana the
//! chain is a quarter of a gigabyte, and copying it into the heap before the
//! first row was read cost each question more than the rows did. A mapping
//! costs the pages a reading touches. A segment is never written in place: the
//! log renames each into place under its digest and removes it by name, so a
//! mapping keeps the bytes it opened even after a writer published past them.
//! A file truncated in place under a mapping is outside that contract: reading
//! past its new end faults.
//!
//! An empty file, which cannot be mapped, is empty bytes.

// compass: variance-authority.reach.source-index

use std::ops::Deref;

pub(crate) enum Mapped {
    Read(Vec<u8>),
    Mapped(memmap2::Mmap),
}

impl Mapped {
    /// The bytes of the file at `path`.
    pub(crate) fn open(path: &str) -> std::io::Result<Self> {
        let file = std::fs::File::open(path)?;
        if file.metadata()?.len() == 0 {
            return Ok(Self::Read(Vec::new()));
        }
        // SAFETY: segments are renamed into place and removed by name, never
        // written in place, so the mapped bytes do not change under a reader.
        unsafe { memmap2::Mmap::map(&file) }.map(Self::Mapped)
    }
}

impl From<Vec<u8>> for Mapped {
    fn from(bytes: Vec<u8>) -> Self {
        Self::Read(bytes)
    }
}

impl Deref for Mapped {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Self::Read(bytes) => bytes,
            Self::Mapped(mapped) => mapped,
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
