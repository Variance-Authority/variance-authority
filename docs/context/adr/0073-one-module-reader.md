# ADR-0073 — one module reader, and it is the addon's

**Status:** accepted
**Date:** 2026-09-25
**Supersedes, for the module reader only:**
[ADR-0065](0065-source-scanning-is-one-native-side.md)'s "The TypeScript
implementation stays, and stays the oracle", and the line under *What this
forecloses* that treats the native binary as optional.
**Relates to:**
[`packages/sense/src/read.ts`](../../../packages/sense/src/read.ts),
[`packages/sense/native/src/read.rs`](../../../packages/sense/native/src/read.rs),
[`packages/sense/src/enrich.ts`](../../../packages/sense/src/enrich.ts)

## Context

ADR-0065 kept the TypeScript module reader as the oracle: every native answer
was compared against it, and it was what ran on a machine without the addon.

A week later the two had drifted. The native reader records `members` — the
names a file reads off a namespace or an `import()` — and the TypeScript one
never learned to. `ask uses` answered differently depending on which reader
the machine had loaded. The differential test could not catch it, because a
field only one side writes is not a disagreement it compares. Each new reading
had to be written twice. The second copy was always the one written late, and
nobody used it: every supported platform gets the addon.

Removing the oracle exposed the opposite drift. The TypeScript reader turned
JSX on for `.js`, `.mjs` and `.cjs`, and the native reader did not. So with the
addon, a React component written in plain JavaScript was a parse error with no
edges. The differential test passed anyway, because this repository has no JSX
in a `.js` file. A unit test written against the TypeScript reader caught it on
the first run against the native one. The fix is `dialect` in `read.rs`, which
the change reader in `module_shape.rs` shares.

## Decision

**There is one module reader, and it is `native/src/read.rs`.**
`readModule(file, contents)` calls the addon's `readSource`. The batch calls
read files off the disk, and `enrich` reads declarations through the addon too.

A machine without the addon cannot read a module. It fails and names the reason
the addon did not load. It never falls back to another reader, and it never
answers with nothing.

Removed with the reader: `depends.ts` (the directive is `native/src/depends.rs`),
`transfer.ts` (the parser options only it used), and the harvest walk in
`harvest.ts`, which now holds only the types the addon hands over. Removed with
the oracle: the tests that compared the two readers over this repository, and
`scripts/read-cost.mjs`, which timed them against each other.

## What stays two-sided

Resolution and record construction still have a JavaScript path.
`native-read.test.ts` holds the native resolver and record builder to it over
this repository. The tree-sitter languages kept their JavaScript readers behind
`accelerated()` in `record.ts` until
[ADR-0074](0074-one-reader-per-tree-sitter-language.md) removed them, and the
scan's own JavaScript seeding and per-file retry went with
[ADR-0075](0075-a-scan-needs-the-addon.md), which also says why the JavaScript
git tree stays.

## Cost

- A platform outside the addon's build matrix cannot scan modules. Before, it
  scanned slowly. The refusal names the platform, so the fix is a build target,
  not a debugging session.
- The oracle is gone, so a change to the reader is checked against fixtures and
  the suite, not against a second implementation. The reader keeps the
  fixture-driven tests it already had.
