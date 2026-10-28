//! The addon's allocator on macOS and Linux: the system's, except that a block
//! of [`LARGE`] bytes or more is mapped from the kernel and unmapped when freed.
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
//! Elsewhere the system allocator is used unchanged.

// FIXME: this is a stopgap. Replacing the allocator is what mimalloc and
// jemalloc were rejected for, and this does it by hand: it bounds the peak only
// because each shard is decoded whole and freed whole. Folding a shard as a
// stream of its columns holds one column at a time, and needs no allocator of
// its own.
use std::alloc::{GlobalAlloc, Layout, System};

/// The size from which a block bypasses the system allocator: far above any
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
        if mapped(&layout) { map(layout.size()) } else { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // A fresh mapping is zero-filled by the kernel.
        if mapped(&layout) { map(layout.size()) } else { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, at: *mut u8, layout: Layout) {
        if mapped(&layout) { unmap(at, layout.size()) } else { System.dealloc(at, layout) }
    }

    unsafe fn realloc(&self, at: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let grown = Layout::from_size_align_unchecked(size, layout.align());
        if !mapped(&layout) && !mapped(&grown) {
            return System.realloc(at, layout, size);
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
