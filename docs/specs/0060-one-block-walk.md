# Spec 0060 — one block walk

**Missing:** a single implementation of the block walk. Two exist today:

- `walk.ts` and `blocks.ts`, the JavaScript walk. It is the implementation of
  record, and it parses through `oxc-parser` and moves the tree into JavaScript.
- `instrument_walk.rs`, the same walk in the addon over the same oxc.

`spliced.test.ts` holds the two to byte equality. The native walk declines what
it cannot spell the way JavaScript does (a regular expression's name, a string
holding a lone surrogate), and in those cases the JavaScript walk answers.
Every rule about what a block is has to be written twice, and
[0057](0057-a-module-block-is-read-before-it-is-charged.md) and
[0058](0058-a-changed-value-is-charged-to-its-readers.md) would add a third
reader of the same tree.
**Built on:** ADR-0065 (the native side of source scanning), the four platform
packages, `native/build.mjs` (the local build for a platform outside the
matrix).

## Purpose

The walk decides the identity every row in the recording is stored under. With
two walks, every change to that identity is a change made twice, checked by a
test that compares them. And the addon, the one that runs, is the one that is
not the reference. With the reading of 0057 and 0058 added, the choice is
either three walks or one.

## What would discharge it

**1. The addon is required to instrument.** `instrument()` without the addon
fails and says why, with the `dlopen` refusal `nativeRefusal()` already keeps.
The four platform packages and a local `cargo build` are the ways to get the
addon. A platform outside the matrix builds locally or does not record. Source
scanning keeps its TypeScript fallback. This spec is about the walk only.

**2. No declines.** Each name the native walk now declines is spelled in Rust:

- a regular expression, as its source text;
- a lone surrogate, escaped as `\u` and its code unit.

The block identities stay the same for every source the walk answers today. A
source that does not parse is left uninstrumented, and the recording says which
file.

**3. The JavaScript walk is deleted.** `walk.ts`, `blocks.ts` and the
JavaScript branch of `spliced.ts` are removed. So is the dependency on
`oxc-parser`, if nothing else uses it. `spliced.test.ts` becomes a golden test:
fixed sources with committed expected output, including the two spellings
above. The ADR that records this decision supersedes ADR-0065 on the walk.
The platform READMEs' paragraph "acceleration, not implementation of record" is
rewritten.

**4. The module reading lives beside the walk.** The verdict of 0057 and the
readers of 0058 are functions of the addon over the same parse. No tree is
sent to JavaScript for them either.

**Acceptance:**

- The golden test passes on each of the four platform builds in the release
  matrix.
- Recording the repository's own suite with the addon gives identical block
  identities before and after the deletion, on every file the native walk
  answered before.
- An `instrument()` call without the addon fails and names the missing package.

## Out of scope

**A WebAssembly build.** It would let an unlisted platform record without a
compiler. Nobody has asked for it, and it is a separate package with its own
cost.
