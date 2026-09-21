# ADR-0069 — every answer has an owner, and computing one yourself is a defect

**Status:** accepted
**Date:** 2026-09-21
**Relates to:** [ADR-0040](0040-git-already-named-every-files-content.md) (the
digest instance),
[ADR-0065](0065-source-scanning-is-one-native-side.md) (the boundary instance),
[journal 0059](../journal/0059-ripgrep-stops-exactly-where-we-do.md),
[journal 0065](../journal/0065-the-read-width-belongs-to-the-machine.md),
[`packages/sense/src/tree.ts`](../../../packages/sense/src/tree.ts),
[`packages/sense/native/src/acquire.rs`](../../../packages/sense/native/src/acquire.rs)

## Context

This project's performance findings do not transfer. Each one is a number on one
machine about one loop, and a person reading them learns that a pack read beats a
worktree read on APFS — which decides nothing about the next loop they write.
What the findings have in common is never written down, so every defect of the
same shape has to be found again by measuring.

Two were found on one afternoon, and they are the same defect.

`scan_graph_with_tree` computed the object name of every file in a wave, used it
to spell an identity string, and then opened all of them off the disk. Git had
named the content and was holding it; the code asked the filesystem instead.

`core.fsmonitor=false` was passed to every `status` call sense makes. Git was
watching the working tree and could say what moved; the flag switched that off and
made git walk. It was not a decision — it is the control row of
`scripts/source-index.mjs`, the setting that benchmark disables in order to
measure what it is worth, copied into the shipped path alongside an unrelated
change. `docs/performance.md` told readers to turn the watcher on while sense
turned it off underneath them.

Neither is a slow loop. Both are an answer that already existed, recomputed.

That shape is most of what this project's performance work has actually been.
The parse cache keyed by content, the records keyed by digest and layout
(ADR-0040), the resolution bounded by the directories a specifier could have been
answered from, the single native side that stops re-crossing a boundary with the
same values (ADR-0065) — none of them made an algorithm faster. Each one found a
party that already knew and stopped asking somebody else.

The measurements agree from the other direction. oxc parses 24.9 MB of TypeScript
in 157 ms, five percent of a cold scan. Widening the readers past six makes a scan
*slower*, because `open` contends on shared locks rather than queueing behind a
device, and ripgrep collapses on the same curve on the same machine. There is no
version of this work where the win comes from computing harder.

## Decision

**Every question sense asks has an owner, and sense routes the question rather
than answering it.**

- **What files exist, what they contain, and what moved** are git's. The tree
  names them, the object database holds them, the index and the file-system
  monitor say what changed.
- **What a specifier means** is the manifest's and the configuration's.
  `package.json` is truth and `dist` is derived.
- **What a module declares** is the parser's.
- **What ran** is the recording's.

Four rules follow, and all four are decidable before anything is measured.

1. **Carry, never recompute.** A value an upstream stage already produced is
   propagated, not derived a second time at the far end. Two ends computing the
   same thing is not a duplication to tidy later; it is breakage waiting for the
   two to disagree.
2. **Holding an answer and not using it is a bug.** `scan_graph_with_tree` had
   the object names in hand. That is the whole finding — no profile was needed to
   see it, and the profile only priced it afterwards.
3. **Never override an owner's configuration.** Passing `core.fsmonitor=false` is
   answering on the repository's behalf. Sense reads what the repository is
   configured to do and does not spend that configuration for it — in either
   direction, because starting a daemon nobody asked for is the same overreach
   wearing the other sign.
4. **Fall back, never fake.** When the owner cannot answer — a dirty file whose
   bytes are in no object, a checkout that is not a repository, a blob that does
   not inflate — sense computes the answer itself and says nothing false about
   where it came from. `read_blob` drops to `open_and_parse` on every failure
   path; `tree.ts` returns nothing at all outside a repository rather than a
   half-tree. This valve is what makes the other three rules safe to apply
   without hedging.

## Consequences

The design question changes shape. It stops being *how do we make this loop
faster* and becomes *whose answer are we ignoring* — a question that can be
answered by reading, which is why it catches defects that profiling finds late or
never. Neither defect above would have survived the question being asked.

It also bounds the work. When no owner is being ignored, the loop is as fast as
it gets, and further effort belongs elsewhere. Going *direct* — an mmapped pack
reader replacing the `cat-file` subprocess — is worth about forty percent of an
already cheap number, and the rule says so plainly rather than leaving it as an
open invitation.

It puts a cost on our own configuration surface. A flag sense passes to a tool it
does not own is now a claim that sense knows better than the repository, and it
has to be argued at the call site. The two overrides removed here had no argument
written anywhere.

The rule reaches past performance, which is the point of stating it here rather
than in a performance page. A record that is invalidated by what could have
answered it (ADR-0059), a skip list bounded by what the record witnessed
(ADR-0062), a name carried from the original rather than recovered from the
emitted shape — these are the same rule about correctness. Derived values drift;
carried ones join.

## Alternatives

**Leave it as a performance note.** The findings were already written down, in
journals 0059, 0063 and 0065, and they did not prevent either defect — including
one committed after they were written. A number does not generalise on its own.

**State it as "prefer caching."** It would be true and useless. Caching is
something you add; this is something you stop doing. The two defects here had no
cache to add — one had the answer already in a local variable, and the other had
it behind a flag that was switched off.
