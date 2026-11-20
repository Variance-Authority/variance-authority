//! The addon's allocator on macOS and Linux: jemalloc, told to return the pages
//! a free empties at once, except that a block of [`LARGE`] bytes or more is
//! mapped from the kernel and unmapped when freed.
//!
//! A cold scan holds tens of millions of small blocks, and the walk frees most
//! of them on its own thread before the follow-ups allocate on others. The
//! system allocators kept those pages resident, so the follow-ups peaked on top
//! of the walk. jemalloc reuses a freed block from any thread, and with no
//! decay it returns a slab to the kernel as soon as its last block is freed;
//! its default decay of ten seconds outlasts the scan.
//!
//! The large path below predates jemalloc and was measured against the system
//! allocators only.
//!
//! macOS's allocator keeps freed large blocks resident in a cache, and reuses
//! one only for a request of nearly its size. A fold decodes each shard into
//! columns of a little more or less than the last shard's, frees them, and
//! decodes the next: the cache missed and grew by every shard it heard, so
//! sixteen shards held well over twice the fold's live state. Reusing the
//! columns' buffers across shards does not stop it, because what a decode
//! frees is not only its columns. A mapping that is returned on free costs one
//! zero-filled page per page touched, which the decode that fills the block
//! pays many times over.
//!
//! glibc maps a block above its threshold and unmaps it on free, but each such
//! free raises the threshold to the block's size, up to 32 MiB. Once the first
//! record's columns are freed, the next record's come from the heap and stay
//! resident there: a landing over an existing record held over a hundred MiB
//! more than the same landing on macOS. On Linux a mapped block that grows is
//! moved with `mremap`, which remaps its pages instead of copying them.
//!
//! Only Rust frees what Rust allocates: a buffer handed to V8 from a `Vec` is
//! freed by its Rust finalizer, on the JS thread, through this allocator; and
//! the C the grammars compile allocates with the system's `malloc`, which the
//! prefixed jemalloc does not replace. Elsewhere, on Windows, the system
//! allocator is used unchanged.

// FIXME: the mapping is a stopgap: it bounds the fold's peak only because each
// shard is decoded whole and freed whole. Folding a shard as a stream of its
// columns holds one column at a time, and needs no path of its own.
use std::alloc::{GlobalAlloc, Layout};

use tikv_jemallocator::Jemalloc;

/// jemalloc's options, read once when it starts. A page a free empties is
/// returned at once instead of after ten seconds, and nothing is kept as
/// lazily freed: a scan is over before either delay runs out.
#[export_name = "_rjem_malloc_conf"]
static MALLOC_CONF: &[u8; 34] = b"dirty_decay_ms:0,muzzy_decay_ms:0\0";

/// The size from which a block bypasses jemalloc: far above any
/// per-row allocation, and below a decoded column of a large record.
const LARGE: usize = 4 << 20;

pub struct Mapped;

fn mapped(layout: &Layout) -> bool {
    layout.size() >= LARGE && layout.align() <= 4096
}

unsafe fn map(size: usize) -> *mut u8 {
    let at = libc::mmap(std::ptr::null_mut(), size, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE | libc::MAP_ANON, -1, 0);
    if at == libc::MAP_FAILED { std::ptr::null_mut() } else { at.cast() }
}

unsafe fn unmap(at: *mut u8, size: usize) {
    libc::munmap(at.cast(), size);
}

unsafe impl GlobalAlloc for Mapped {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if mapped(&layout) { map(layout.size()) } else { Jemalloc.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // A fresh mapping is zero-filled by the kernel.
        if mapped(&layout) { map(layout.size()) } else { Jemalloc.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, at: *mut u8, layout: Layout) {
        if mapped(&layout) { unmap(at, layout.size()) } else { Jemalloc.dealloc(at, layout) }
    }

    unsafe fn realloc(&self, at: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let grown = Layout::from_size_align_unchecked(size, layout.align());
        if !mapped(&layout) && !mapped(&grown) {
            return Jemalloc.realloc(at, layout, size);
        }
        #[cfg(target_os = "linux")]
        if mapped(&layout) && mapped(&grown) {
            let at = libc::mremap(at.cast(), layout.size(), size, libc::MREMAP_MAYMOVE);
            return if at == libc::MAP_FAILED { std::ptr::null_mut() } else { at.cast() };
        }
        let moved = self.alloc(grown);
        if !moved.is_null() {
            std::ptr::copy_nonoverlapping(at, moved, layout.size().min(size));
            self.dealloc(at, layout);
        }
        moved
    }
}
