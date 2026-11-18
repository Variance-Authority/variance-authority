---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance index` builds and publishes every supported language in Rust, removing the JavaScript indexing fallback and per-file language handoffs. Indexed files use retained pack readers, including in fragmented Git stores. Dirty, untracked, symbolic and LFS content keeps its working-tree boundary. `--no-git` reads working-tree bytes while keeping native graph construction. Repeated source lines, signatures and comments share memory and binary storage, and language readers calculate UTF-16 offsets once per file.

Set `VARIANCE_SENSE_TIMINGS=1` when running `variance index` to print plain-text timings for setup, acquisition, parsing, resolution, binary publication and the follow-ups, including acquisition/parse overlap. Follow-ups share indexed configuration bytes and declaration facts. Configuration changes rebuild resolved records while preserving the index's immutable base. Wildcard package entries inspect the files their package owns.

Source resolution answers missing ordinary candidates from the active file listing. An unresolved relative import with an explicit supported extension can still enter the exact file it names outside that listing, including ignored source. Oversized files keep their refusal while Git names the same file and its selected blob or checked-out regular file remains oversized; this never shares a parse. Dirty parsed files are read again even when a Git clean filter gives them the same object identity, because that identity does not prove their raw checked-out bytes. Region counting skips instrumentation output, and question indexing splits words without intermediate character or word lists. Member-use queries respect inner lexical bindings declared after the use.
