# The cold graph stayed on one side

ADR-0065 drew the boundary: Git identity, parsing, extraction and resolution
belong on one native side, while the TypeScript implementation remains the
oracle and the fallback. The first repository-scale run of that boundary is now
complete.

The reproduction is the source-index benchmark against the frontend repository,
with `jira` as its seed:

```bash
yarn build
TARGET_REPOSITORY=/absolute/path/to/a/clean/frontend-repository
node packages/sense/scripts/source-index.mjs \
  "$TARGET_REPOSITORY" jira
```

The same cold and unchanged operations were repeated without the benchmark's
`parsed` callback, because normal graph construction does not ask for every
parse as a JavaScript object:

```text
cold
  185,825 records
  open       0.000 s
  scan      13.720 s
  publish    1.450 s
  total     15.170 s
  index    148,056,720 bytes
  peak RSS   3.07 GiB

unchanged
  185,825 records
  open       1.877 s
  scan       4.791 s
  publish    0.360 s
  total      7.028 s
  index    148,056,720 bytes
  peak RSS   2.04 GiB
```

The graph reaches outside the seed as intended. The design-system button entry
under `platform/packages` is present with five incoming and seven outgoing
edges. The seed excludes ignored generated trees named `tsDist` and
`storybook-static`; those held 143,406 readable files but are not source Git can
name or a diff can reach. The resulting record count is therefore the reachable
source graph, not every readable artifact below the directory.

## What crossed, and what did not

The Rust side keeps the repository path set, reads clean files through persistent
`git cat-file --batch` streams, falls back to disk for dirty paths, parses with
OXC, resolves the complete module closure and emits dense relation columns. It
also writes the parse half of the existing source-index format, so a cold run
does not serialize every parse through JSON merely to encode it again.

JavaScript still owns the public `FileRecord` shape, record witnesses, cache
adoption and publication. A missing or rejected addon falls back to the old
per-file implementation. The boundary has one accelerated implementation and
one semantic implementation of record, not two products or two databases.

The duplicated source-index encoding is held to the TypeScript decoder by a
differential test over every module in this repository. The native reader is
also compared against the JavaScript reader and resolver over the same corpus.

## The correctness cost of spelling a path

The first full fixture run found a case the repository-wide resolver comparison
did not contain. On a case-insensitive filesystem, OXC may answer
`./legacy.js` with the requested spelling of `legacy.tsx` even when the file on
disk is `Legacy.tsx`. Accepting that path creates a phantom node and leaves the
real `legacy.js` without its importer.

Canonicalizing every resolved edge fixed the answer and moved the cold scan to
43.4 seconds: the correction had become one syscall per edge. The settled rule
uses the Git tree as the spelling oracle. An exact path already present in the
snapshot needs no syscall; only an answer absent from that tree is canonicalized,
and those results are memoized. The case-folding fixture passes and the cold scan
returns to 15.2 seconds.

That is the useful boundary in miniature: Git owns repository identity, OXC owns
resolution, and the narrow translation between them owns filesystem spelling.
Neither implementation silently assumes the other's representation is already
canonical.
