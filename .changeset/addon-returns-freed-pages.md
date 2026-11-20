---
'@variance-authority/sense': patch
---

A first `variance index` on a large checkout holds less memory at its peak. On macOS and Linux the native scanner allocates its small blocks with jemalloc, which gives back a page as soon as everything on it is freed, where the system allocator kept the pages the scan's first pass freed while the later passes allocated more. On generated monorepos of about 96,000 source files on macOS, peak resident memory fell from 4.4–4.6 GB to 2.3 GB and from 5.3 GB to 2.5 GB, and the index took no longer; Linux runs the same allocator and has not been measured yet. Windows is unchanged.
