//! The addon's allocator: the system's, except that a block of
//! [`LARGE`] bytes or more is mapped from the kernel and unmapped when freed.
//!
//! macOS's allocator keeps freed large blocks resident in a cache, and reuses
//! one only for a request of nearly its size. A fold decodes each shard into
//! columns of a little more or less than the last shard's, frees them, and
//! decodes the next: the cache missed and grew by every shard it heard, so
//! sixteen shards held well over twice the fold's live state. A mapping that is
//! returned on free costs one zero-filled page per page touched, which the
//! decode that fills the block pays many times over.

use std::alloc::{GlobalAlloc, Layout, System};

/// The size from which a block bypasses the system allocator: far above any
/// per-row allocation, and below a decoded column of a large record.
const LARGE: usize = 4 << 20;

pub struct Mapped;

fn mapped(layout: &Layout) -> bool {
    cfg!(unix) && layout.size() >= LARGE && layout.align() <= 4096
}

#[cfg(unix)]
unsafe fn map(size: usize) -> *mut u8 {
    let at = libc::mmap(std::ptr::null_mut(), size, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE | libc::MAP_ANON, -1, 0);
    if at == libc::MAP_FAILED { std::ptr::null_mut() } else { at.cast() }
}

#[cfg(unix)]
unsafe fn unmap(at: *mut u8, size: usize) {
    libc::munmap(at.cast(), size);
}

#[cfg(not(unix))]
unsafe fn map(_: usize) -> *mut u8 {
    unreachable!()
}

#[cfg(not(unix))]
unsafe fn unmap(_: *mut u8, _: usize) {
    unreachable!()
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
        let moved = self.alloc(grown);
        if !moved.is_null() {
            std::ptr::copy_nonoverlapping(at, moved, layout.size().min(size));
            self.dealloc(at, layout);
        }
        moved
    }
}
