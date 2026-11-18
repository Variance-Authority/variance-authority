//! The resolver adapter for the namespace and bytes its active tree owns.

// compass: variance-authority.reach.source-scan

use std::io;
use std::path::{Path, PathBuf};
use oxc_resolver::{FileMetadata, FileSystem, FileSystemOs, ResolveError};
use super::{Emitted, Origin, not_found};

impl Emitted {
    fn read_disk(&self, path: &Path) -> io::Result<Vec<u8>> {
        let listing = self.read_blobs.then(|| self.listed.as_ref().map(|(_, listing)| listing.as_ref())).flatten();
        super::read_content(listing, path)
    }
}

impl FileSystem for Emitted {
    fn new() -> Self {
        Self::default()
    }

    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        match self.origin(path) {
            Origin::Disk => self.read_disk(path),
            Origin::Source(source) => self.read_disk(&source),
            Origin::Directory | Origin::Nowhere => Err(not_found()),
        }
    }

    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        FileSystemOs::validate_string(self.read(path)?)
    }

    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        match self.origin(path) {
            Origin::Disk => self.disk_metadata(path, FileSystemOs::metadata),
            Origin::Directory => Ok(FileMetadata::new(false, true, false)),
            Origin::Source(_) => Ok(FileMetadata::new(true, false, false)),
            Origin::Nowhere => Err(not_found()),
        }
    }

    fn symlink_metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        match self.origin(path) {
            Origin::Disk => self.disk_metadata(path, FileSystemOs::symlink_metadata),
            _ => self.metadata(path),
        }
    }

    fn read_link(&self, path: &Path) -> Result<PathBuf, ResolveError> {
        match self.origin(path) {
            Origin::Disk => FileSystemOs::read_link(path),
            _ => Err(io::Error::from(io::ErrorKind::InvalidInput).into()),
        }
    }

    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        match self.origin(path) {
            Origin::Disk => self.disk_canonicalize(path),
            Origin::Nowhere => Err(not_found()),
            Origin::Directory | Origin::Source(_) => self.canonical(path),
        }
    }
}
