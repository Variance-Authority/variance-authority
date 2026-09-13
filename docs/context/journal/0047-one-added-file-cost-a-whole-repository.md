# One added file cost a whole repository

[Journal 0043](./0043-the-index-was-being-rebuilt-to-change-ten-files.md) put a
persistent index behind the scan so that a run over an unchanged repository stops
re-resolving it. It works: on `mui/material-ui` at `62a348bf47` — 41,165 tracked
paths, 24,909 records — a warm run costs 622 ms against 2,953 cold, and a run
that edited four files costs 599.

Then somebody adds a file.

```
node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
```

| the tree is | total | records rebuilt | files opened |
|---|---|---|---|
| unchanged | 622 ms | 0 | 0 |
| 500 files edited | 639 ms | 500 | 478 |
| **1 file added** | **1,253 ms** | **24,909** | 1 |
| **100 in, 100 out, 500 edited** | **1,293 ms** | **24,909** | 479 |

The last two rows are the same run. Adding one path and moving seven hundred cost
the same thing, because both throw the index away: a record was kept under a
digest of every tracked path, so any path appearing or disappearing invalidated
every record in the repository. The counters say why it was survivable and why it
was still wrong — 479 files were opened, not 24,909, because parses are keyed by
content and outlive the records built from them. The repository was not re-read.
It was re-resolved.

On a branch taking a hundred pull requests an hour a path moves every few
minutes, which makes 1,253 ms the real warm number and 622 the one you get
between landings. An index that is only warm when nothing is happening is not an
index.

## What a record actually depends on

Four things, and the old rule named the fourth one as *the whole tree*:

| | named by |
|---|---|
| the file's bytes | its content digest |
| where the file sits | its path |
| how resolution is configured | manifests, lockfiles, `tsconfig` contents, conditions |
| which paths could have answered it | — |

A resolver asked for `./button` from `src/panel` looks in `src/panel` for a name
it can extend and in `src/panel/button` for an index. Ten thousand files can
appear under `docs/` and the answer is the answer it already was. So the fourth
row is not the tree; it is the **directories that specifier probed**, and those
are derivable from the specifier itself.

Derived from the specifier, not from the answer — because the case that matters
is the one that resolved to *nothing*. `./later` finds nothing today and finds
`later.ts` tomorrow, and a rule that watched only where requests landed would
never look. Where a request did resolve, the directory holding the answer is a
witness as well: that is the one place a `package.json` `main` sends a lookup
somewhere no lexical reading predicts.

A bare specifier is answered from `node_modules`, which git does not track, so no
tracked path can change it — unless a `tsconfig` maps it, which is read from the
`paths` and `baseUrl` every tracked configuration declares. A configuration that
cannot be parsed, or that `extends` a package rather than a path, is no bound at
all; there the whole path set goes back into the configuration digest, which is
the old rule applied on purpose and to one repository rather than to all of them.

## Two ways to store it, and the one the tree decided

Either persist a digest per directory and a witness list per record, and make the
reuse check a set membership test; or persist one combined witness digest per
record and recompute it each run. The second is less to store and costs ~25,000
digests on every run including the ones where nothing moved.

The tree settled it. Material-ui's 41,165 paths are only **1,492 directories**:
bucketing them costs 19 ms and digesting the result 4.5 ms. The map is small
enough to carry and cheap enough to rebuild, and a run where no directory moved
then does no work at all.

## After

Same command, same repository, same script:

| the tree is | total | records rebuilt | files opened |
|---|---|---|---|
| cold, no index | 3,084 ms | 24,909 | 24,825 |
| unchanged | 659 ms | 0 | 0 |
| 4 files edited | 697 ms | 4 | 4 |
| 500 files edited | 819 ms | 500 | 478 |
| **1 file added** | **719 ms** | **104** | 1 |
| **100 in, 100 out, 500 edited** | **935 ms** | **1,064** | 479 |

One added file rebuilds 104 records — its directory's neighbours and whoever was
importing into it — instead of 24,909. Seven hundred paths moved rebuilds 1,064,
which is the 500 the edit is worth plus the neighbourhoods around the rest. The
flat toll is gone and the cost tracks the diff.

The index grew from 7.4 MB to 7.9 MB for the witness lists and the directory map,
and a warm run costs about 37 ms more for reading and writing them. Both are
bought with the row that used to read 1,253.

An earlier attempt made it 9.6 MB, by making every candidate path a witness
whether or not it was a directory. It need not be: a directory that does not
exist yet cannot appear without its parent gaining an entry, and the parent is
already watched. Filtering candidates against the directory map costs nothing and
removed 1.7 MB of interned paths.

## What is still fixed cost

The 650 ms underneath every warm row, which is the repository walked to decide
not to touch it, and the ~190 ms publish — a chain decoded a second time to
compare against, and a deep comparison over 24,825 parses and 24,909 records to
find there is nothing to say. Neither scales with the diff either, and neither is
git's.
