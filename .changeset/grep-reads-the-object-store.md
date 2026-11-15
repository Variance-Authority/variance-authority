---
'@variance-authority/sense': patch
---

`ask grep` reads tracked, unchanged files from git's object store

`ask grep`, `docs_grep` and `ask discover --text` opened every file a start point reaches. A search over three thousand files or more now reads each tracked file that git's index holds as unchanged straight out of the object store, in the addon's own process, and opens only the rest. The answer is unchanged, line for line. On Kibana, a search over `x-pack`'s 94,000 files takes about 220 ms where it took about 990, and `rg` over the same folder takes about 1,030; over `src`'s 38,000 files it takes about 100 ms where it took 350. A smaller search is the one it was.

A repository whose blobs may not be the bytes on disk is searched from disk whole: one with a replace ref, a smudge or process filter other than git-lfs's, a `working-tree-encoding` or `ident` attribute in any attribute file git reads, an object format other than SHA-1, more than fifty packs and no multi-pack index, or a git older than 2.42, which cannot name its attribute files.
