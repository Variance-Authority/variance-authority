# ADR-0075 — a scan needs the addon, and says so before it opens anything

**Status:** accepted
**Date:** 2026-09-25
**Supersedes:**
[ADR-0065](0065-source-scanning-is-one-native-side.md)'s "what runs on a
checkout with no Rust toolchain — which is a supported configuration, not a
degraded one", and the line under *What this forecloses* that rules out
"treating the native binary as required", for the whole scan.
[ADR-0073](0073-one-module-reader.md) and
[ADR-0074](0074-one-reader-per-tree-sitter-language.md) had already set both
aside for the readers.
**Relates to:**
[`packages/sense/src/scan.ts`](../../../packages/sense/src/scan.ts),
[`packages/sense/src/files.ts`](../../../packages/sense/src/files.ts),
[`packages/sense/src/tree.ts`](../../../packages/sense/src/tree.ts),
[`packages/sense/native/src/seed.rs`](../../../packages/sense/native/src/seed.rs)

## Context

With the readers native-only, `scan.ts` still had three JavaScript paths beside
native ones. Each was asked the same question: does it do anything besides
stand in for a missing addon?

**The JavaScript `seedFiles`** walked the filesystem for the files to scan when
there was no git tree and no addon. With the addon, `seed_files` in `seed.rs`
did the same walk. So the JavaScript walk's only job was the machine without
the addon — which, since ADR-0073, could not read the first module the walk
found. It seeded a scan that could not finish.

**The per-file retry after a native batch threw.** The batch was wrapped in a
bare `catch {}`, and every pending module was then recorded one at a time by
`recordFor`. Since ADR-0073 that path reads each module through the same addon.
It differs from the batch only in resolving and building the record in
JavaScript. So a batch that failed was answered by a different record builder,
and nobody was told: [ADR-0069](0069-every-answer-has-an-owner.md) allows a
fallback only when it says so, and this one said nothing. It answered nothing a
working batch did not; its whole effect was to hide a panic or a batch defect
behind a slower scan.

**The JavaScript git-tree walk in `tree.ts`** has a job of its own, and stays:

- It answers `changed`. A caller that already knows which paths moved hands
  them in and gets only those re-hashed rather than a full `git status`:
  `variance ask --changed-file` carries its list through `help`'s refresh into
  the scan this way. The native `gitTree` takes no such list.
- It is the tree over digests a caller supplies (`treeOf`), which the scan
  takes as `digests`.
- `gitDigests` is a public export named in the package README.

`native.test.ts` compares the two trees because both are live, not because one
checks the other. `seedPaths`, which seeds from whichever tree the scan holds,
stays with it.

## Decision

**`scanRelations` needs the addon, and checks for it once, before anything is
opened.** It throws with `nativeRefusal()`, like every other command whose
native side has no stand-in.

- Seeds come from the tree when there is one, and otherwise from the addon's
  `seed_files`. The JavaScript walk is removed.
- A native batch that throws fails the scan with its own error. The per-file
  retry is removed.
- `recordFor` stays. It builds the records the batch is never asked for:
  stylesheets and the tree-sitter languages.

## What stays two-sided

- The JavaScript tree, for the reasons above.
- The JavaScript resolver and record builder. `recordFor` builds records with
  them for every language the batch does not read, and taint (`taint/join.ts`)
  resolves through `resolveTo`. `native-read.test.ts` holds the native resolver
  and record builder to them over this repository.

## Cost

- **Without the addon, nothing scans** — a tree of stylesheets included, which
  needs no parser from the addon and scanned before. The refusal names why the
  addon did not load, and a platform outside the four scans once the addon is
  built from the checkout.
- **A native panic fails the run.** It used to be absorbed and retried file by
  file, so the same scan produced a graph, slower, and nobody learned the batch
  had a defect. Now a scan that hits one produces no graph until it is fixed.
- **Gains.** One walk instead of two, whose `EXTENSIONS` list
  `native-readable.check.ts` keeps in step with the reader tables; no silent
  branch in the scan's hot loop.
