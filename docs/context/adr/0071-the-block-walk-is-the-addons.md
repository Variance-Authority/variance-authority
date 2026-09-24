# ADR-0071 — the block walk is the addon's, and there is no other

**Status:** accepted
**Date:** 2026-09-24
**Supersedes [ADR-0065](0065-source-scanning-is-one-native-side.md) for the
block walk**, and only for it: the scan keeps its TypeScript implementation as
the oracle.
**Relates to:**
[`packages/sense/native/src/instrument_walk.rs`](../../../packages/sense/native/src/instrument_walk.rs),
[`packages/sense/src/instrument/spliced.ts`](../../../packages/sense/src/instrument/spliced.ts),
[`packages/sense/src/instrument/__fixtures__/spliced-golden.ts`](../../../packages/sense/src/instrument/__fixtures__/spliced-golden.ts)

## Context

The walk decides where a probe goes and what the region behind it is called,
and that name is the identity every row of a recording is stored under. There
were two walks: `walk.ts` and `blocks.ts` in JavaScript, the implementation of
record, reading the tree `oxc-parser` handed across; and `instrument_walk.rs` in
the addon, over the same oxc, never letting the tree cross. A test held them to
byte equality over the repository's own source. The native walk declined two
names it could not spell the JavaScript way — a regular expression used as a
key, and a string holding a lone surrogate — and the JavaScript walk answered
those modules.

ADR-0065 argued that `instrument`, like the encoder, only relocates the
boundary crossing. The addon's walk showed otherwise: what crosses is the
instrumented text and one column per block field, and the tree stays in the
arena. So the stage is in the same position the scan was in, and the
oracle arrangement cost it three things:

- every rule about what a block is had to be written twice, in two languages;
- the walk that ran was the one that was not the reference;
- the reading of a changed module that selection needs next — which top-level
  statements run at load, and which regions read a changed value — would have
  been a third reader of the same tree.

## Decision

**The addon's walk is the only walk.** `walk.ts` and `blocks.ts` are deleted,
and `spliced.ts` keeps what a caller has to understand: the block vocabulary,
and the mapping from the addon's columns back to blocks.

- **No declines.** A regular expression is named as `String(regex)` spells it,
  flags in order. A lone surrogate in a string key is written `\uXXXX`, and a
  real U+FFFD stays itself.
- **A source holding a lone surrogate in its text is left uninstrumented.** The
  boundary into Rust would replace it, and every offset after it would describe
  a different string. The module is recorded as uninstrumented, like a source
  that does not parse.
- **No addon is an error, not an uninstrumented module.** Every module would be
  uninstrumented, and a run that records nothing looks like a run in which
  nothing ran. The error carries the loader's refusal, which names the package
  or the `dlopen` message.
- **The equality test becomes a golden test.** The whole answer for each fixture
  in both modes — code, header offset, every block field — was written from the
  JavaScript walk while it still existed, and is committed. A change to it is a
  change to every recording's identity and needs a new instrumentation id.
- **The module reading lives beside the walk**, over the same parse, when it
  is built. No tree is sent to JavaScript for it either.

## Alternatives

**Keep both walks, with the JavaScript one as the reference.** This is the
arrangement being replaced. It is what lets a platform without the addon
record, and it costs every rule twice.

**Keep the JavaScript walk only.** The tree crosses for every instrumented
module. That is the cost the addon was built to remove, and the readers the next
specs need would pay it again.

**A WebAssembly build of the addon.** It would let a platform outside the matrix
record without a compiler. Nobody has asked for it, and it is a separate package
with its own release cost.

## Cost

- **A platform outside the four prebuilt ones does not record** until somebody
  builds the addon there with `cargo`. Scanning still degrades to TypeScript.
  Recording does not.
- **Two kinds of module change identity.** A block named from a key with a lone
  surrogate is renamed with the escape. A module whose text holds a lone surrogate
  was instrumented by the JavaScript walk and is now left uninstrumented. The
  native walk declined both before, so a recording made on a machine with the
  addon already named them through the JavaScript walk. Those rows stop matching
  and are recorded again on the next run.
- **The golden fixtures are the only witness of the old identities.** Nothing
  can regenerate them. A fixture added later is written from the addon's own
  answer, and it proves stability rather than agreement.
- **`Edit` leaves the public surface of `./instrument`.** It described one
  insertion of the JavaScript walk, and no caller outside the package read it.
