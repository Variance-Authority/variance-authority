---
'@variance-authority/sense': patch
---

`ask grep` reads tracked, unchanged files from git's object store

`ask grep`, `docs_grep` and `ask discover --text` opened every file a start point reaches. A search over three thousand files or more now reads each tracked file that git's index holds as unchanged straight out of the object store, in the addon's own process, and opens only the rest. The answer is unchanged, line for line. On Kibana, a search over `x-pack`'s 94,000 files takes about 220 ms where it took about 990, and `rg` over the same folder takes about 1,030; over `src`'s 38,000 files it takes about 100 ms where it took 350. A smaller search is the one it was.

A repository whose blobs may not be the bytes on disk is searched from disk whole: one with a replace ref, a clean, smudge or process filter other than git-lfs's, a `working-tree-encoding` in any attributes file, tracked or not, an untracked attributes file naming `ident`, an object format other than SHA-1, or more than fifty packs and no multi-pack index. A file whose checkout git rewrote to another length, by line endings or `ident`, is opened, and so is a file holding `$Id` where an attributes file names `ident`. A file an encoding or filter rewrote at its length, before that attribute was removed, is searched as its blob: `git status` calls it unchanged too, until it is checked out again.

The scan reads committed blobs through the same in-process reader and starts no `git cat-file` process. In a repository with a replace ref, it parsed the replacement's bytes for a file whose checkout was the original; it now parses the file on disk.
