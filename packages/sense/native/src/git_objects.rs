//! Indexed bytes from retained native handles or Git's buffered pack reader.
// compass: variance-authority.reach.source-index

use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use gix_hash::ObjectId;
use gix_object::{Find as _, Kind};
use gix_odb::Header as _;
use rayon::prelude::*;

use super::{few_packs, git, replaced, Fresh};
use crate::commit_text::{Open, PackedBlob};
use crate::git::Oid;

/// A repository's object bytes, shared by source and configuration reads.
pub(crate) struct Objects {
    store: Arc<gix_odb::Store>,
    readers: Mutex<Vec<Reader>>,
    packed: Option<Packed>,
}

/// Fragmented stores keep one buffered Git process per acquisition lane.
struct Packed {
    root: String,
    readers: Mutex<Vec<Open>>,
}

/// One thread's handle on the store, with the buffer it inflates into.
pub(crate) struct Reader {
    objects: gix_odb::store::Handle<Arc<gix_odb::Store>>,
    buffer: Vec<u8>,
}

impl Objects {
    /// The repository's bytes, using buffered Git when native lookups would
    /// search too many pack indexes.
    pub(crate) fn open(root: &Path) -> Option<Objects> {
        let located = git(root, &["rev-parse", "--show-object-format", "--git-path", "objects"])?;
        let mut lines = located.lines();
        let (format, objects) = (lines.next()?, lines.next()?);
        Objects::at(format, &root.join(objects), replaced(root)?, Some(root))
    }

    pub(super) fn at(format: &str, objects: &Path, replaced: bool, packed_root: Option<&Path>) -> Option<Objects> {
        if format != "sha1" || replaced { return None; }
        let packed = if few_packs(objects) { None }
            else {
                let root = packed_root?.to_str()?;
                Some(Packed { root: root.to_owned(), readers: Mutex::new(vec![Open::packed(root).ok()?]) })
            };
        if crate::timings::enabled() {
            eprintln!("sense Git objects: {}", if packed.is_some() { "persistent buffered pack reader" } else { "retained native pack readers" });
        }
        let store = gix_odb::Store::at_opts(objects.to_owned(), gix_hash::Kind::Sha1, &mut std::iter::empty(), Default::default()).ok()?;
        Some(Objects { store: Arc::new(store), readers: Mutex::default(), packed })
    }

    /// A handle for one lane; it never refreshes the pack directory.
    pub(crate) fn reader(&self) -> Reader {
        let mut objects = self.store.to_handle_arc();
        objects.refresh_never();
        Reader { objects, buffer: Vec::new() }
    }

    pub(crate) fn is_packed(&self) -> bool { self.packed.is_some() }

    /// Retain each lane's pack ordering and inflate buffer between waves.
    pub(crate) fn with_readers<T>(&self, count: usize, read: impl FnOnce(&mut [Reader]) -> T) -> T {
        let mut pooled = self.readers.lock().unwrap_or_else(PoisonError::into_inner);
        let from = pooled.len().saturating_sub(count);
        let mut readers = pooled.split_off(from);
        drop(pooled);
        readers.resize_with(count, || self.reader());
        let result = read(&mut readers);
        self.readers.lock().unwrap_or_else(PoisonError::into_inner).append(&mut readers);
        result
    }

    /// Bounded raw bytes, retaining one result for every indexed identity.
    pub(crate) fn blobs(&self, ids: &[Oid], largest: u64) -> Vec<Result<PackedBlob, String>> {
        self.blobs_with_readers(ids, largest, 1)
    }

    /// Independent retained protocol owners let the opening pool read in parallel.
    pub(crate) fn blobs_with_readers(&self, ids: &[Oid], largest: u64, count: usize) -> Vec<Result<PackedBlob, String>> {
        if ids.is_empty() { return Vec::new(); }
        let count = count.max(1).min(ids.len());
        let chunk = ids.len().div_ceil(count);
        if let Some(packed) = &self.packed {
            let mut readers = packed.readers.lock().unwrap_or_else(PoisonError::into_inner);
            while readers.len() < count {
                match Open::packed(&packed.root) {
                    Ok(reader) => readers.push(reader),
                    Err(why) => return ids.iter().map(|_| Err(why.to_string())).collect(),
                }
            }
            let rows = ids.par_chunks(chunk).zip(readers[..count].par_iter_mut()).flat_map_iter(|(ids, reader)| {
                reader.blobs(ids, largest).unwrap_or_else(|why| ids.iter().map(|_| Err(why.clone())).collect())
            }).collect();
            return rows;
        }
        self.with_readers(count, |readers| ids.par_chunks(chunk).zip(readers.par_iter_mut()).flat_map_iter(|(ids, reader)| {
            ids.iter().map(move |id| reader.acquire(&ObjectId::from_bytes_or_panic(id), largest))
        }).collect())
    }

    /// Only LFS returns `None`; a missing or unreadable blob is an error.
    pub(crate) fn blob_bytes(&self, id: &Oid) -> io::Result<Option<Vec<u8>>> {
        self.blob_bytes_many(&[*id]).pop().expect("one indexed blob has one answer")
    }

    /// Configuration-sized batches use the same pack engine as source reads.
    pub(crate) fn blob_bytes_many(&self, ids: &[Oid]) -> Vec<io::Result<Option<Vec<u8>>>> {
        if self.packed.is_none() {
            return self.with_readers(1, |readers| ids.iter().map(|id| {
                readers[0].raw_blob(&ObjectId::from_bytes_or_panic(id))
                    .map(|bytes| (!crate::lfs::pointer(bytes)).then(|| bytes.to_vec()))
            }).collect());
        }
        let read = match (ids.len() > 1).then(|| crate::acquire::opening_pool(None, ids.len())) {
            // A lazy content owner can run in Rayon. Joining from a plain
            // thread keeps `install` from stealing a reader waiting on it.
            Some(Ok(pool)) => std::thread::scope(|scope| {
                scope.spawn(|| pool.install(|| self.blobs_with_readers(ids, u64::MAX, pool.current_num_threads())))
                    .join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            }),
            _ => self.blobs(ids, u64::MAX),
        };
        read.into_iter().map(|read| match read {
            Ok(PackedBlob::Bytes(bytes)) => Ok((!crate::lfs::pointer(&bytes)).then_some(bytes)),
            Ok(PackedBlob::Large(_)) => unreachable!("the unbounded configuration read accepts every blob size"),
            Err(why) => Err(io::Error::other(why)),
        }).collect()
    }
}

impl Reader {
    /// An indexed blob, with errors kept distinct from transformed content.
    pub(super) fn raw_blob(&mut self, id: &ObjectId) -> io::Result<&[u8]> {
        let data = self.objects.try_find(id, &mut self.buffer)
            .map_err(|error| io::Error::other(error.to_string()))?
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("Git blob {id} is not available")))?;
        if data.kind != Kind::Blob {
            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("Git object {id} is not a blob")));
        }
        Ok(data.data)
    }

    /// Read only a bounded blob body after checking its header.
    pub(crate) fn acquire(&mut self, id: &ObjectId, largest: u64) -> Result<PackedBlob, String> {
        let header = self.objects.try_header(id).map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Git blob {id} is not available"))?;
        if header.kind() != Kind::Blob { return Err(format!("Git object {id} is not a blob")); }
        if header.size() > largest { return Ok(PackedBlob::Large(header.size())); }
        self.raw_blob(id).map(|bytes| PackedBlob::Bytes(bytes.to_vec())).map_err(|error| error.to_string())
    }

    /// The size of the blob `id` names, or `None` where the store holds no blob by it.
    pub(crate) fn size(&mut self, id: &ObjectId) -> Option<u64> {
        let header = self.objects.try_header(id).ok()??;
        (header.kind() == Kind::Blob).then(|| header.size())
    }

    /// The bytes of the blob `id` names, or `None` to read the worktree: the
    /// store holds no blob by it, or holds a git-LFS pointer, which checkout
    /// smudged into other bytes.
    pub(crate) fn blob(&mut self, id: &ObjectId) -> Option<&[u8]> {
        self.raw_blob(id).ok().filter(|bytes| !crate::lfs::pointer(bytes))
    }

    /// The bytes `fresh` was checked out from, or `None` to read the worktree,
    /// as for a blob holding `$Id` where `ident` may have rewritten it.
    pub(crate) fn checkout_bytes(&mut self, fresh: &Fresh) -> Option<&[u8]> {
        if self.size(&fresh.id)? != fresh.size {
            return None;
        }
        let blob = self.blob(&fresh.id)?;
        (!fresh.ident || memchr::memmem::find(blob, b"$Id").is_none()).then_some(blob)
    }
}
