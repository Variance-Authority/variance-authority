//! The emitted view as the resolver's file system: every question oxc asks of
//! a path is answered from where `Emitted::origin` puts it — the source it is
//! built from, the listing git holds, or the disk.

// compass: variance-authority.reach.source-scan

use std::io;
use std::path::{Path, PathBuf};

use oxc_resolver::{FileMetadata, FileSystem, FileSystemOs, ResolveError};

use super::{Emitted, Known, Origin};

pub(super) fn not_found() -> io::Error {
    io::Error::from(io::ErrorKind::NotFound)
}

/// A listed path is no link: git keeps nothing beneath one, and lists one as
/// a path it does not vouch for.
pub(super) fn listed(known: Known) -> io::Result<FileMetadata> {
    match known {
        Known::File => Ok(FileMetadata::new(true, false, false)),
        Known::Directory => Ok(FileMetadata::new(false, true, false)),
        Known::Absent => Err(not_found()),
    }
}

impl FileSystem for Emitted {
    fn new() -> Self {
        Self::default()
    }

    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        match self.origin(path) {
            Origin::Disk if self.known(path).map_or_else(|| self.absent(path), |known| known != Known::File) => Err(not_found()),
            Origin::Disk => std::fs::read(path),
            Origin::Source(source) => std::fs::read(source),
            Origin::Directory | Origin::Nowhere => Err(not_found()),
        }
    }

    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        FileSystemOs::validate_string(self.read(path)?)
    }

    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        match self.origin(path) {
            Origin::Disk => self.stat(path),
            Origin::Directory => Ok(FileMetadata::new(false, true, false)),
            Origin::Source(_) => Ok(FileMetadata::new(true, false, false)),
            Origin::Nowhere => Err(not_found()),
        }
    }

    fn symlink_metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        match self.origin(path) {
            Origin::Disk => match self.known(path) {
                Some(known) => listed(known),
                None if self.absent(path) => Err(not_found()),
                None => FileSystemOs::symlink_metadata(path),
            },
            _ => self.metadata(path),
        }
    }

    fn read_link(&self, path: &Path) -> Result<PathBuf, ResolveError> {
        match self.origin(path) {
            Origin::Disk => match self.known(path) {
                None if self.absent(path) => Err(not_found().into()),
                None => FileSystemOs::read_link(path),
                Some(Known::Absent) => Err(not_found().into()),
                Some(_) => Err(io::Error::from(io::ErrorKind::InvalidInput).into()),
            },
            _ => Err(io::Error::from(io::ErrorKind::InvalidInput).into()),
        }
    }

    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        match self.origin(path) {
            // A listed path is spelled under the canonical root with no link in it.
            Origin::Disk => match self.known(path) {
                None if self.absent(path) => Err(not_found()),
                None => FileSystemOs::canonicalize(path),
                Some(Known::Absent) => Err(not_found()),
                Some(_) => Ok(path.to_owned()),
            },
            Origin::Nowhere => Err(not_found()),
            Origin::Directory | Origin::Source(_) => self.canonical(path),
        }
    }
}
