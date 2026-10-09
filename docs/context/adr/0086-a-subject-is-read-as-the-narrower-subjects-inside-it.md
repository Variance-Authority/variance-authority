# ADR-0086 — a subject is read as the narrower subjects inside it

**Status:** accepted
**Date:** 2026-10-10
**Relates to:** [ADR-0035](0035-a-node-stands-in-every-component-above-it.md)
(a node stands in every component above it),
[ADR-0056](0056-a-journey-is-the-places-visited.md) (a journey is the places
visited),
[`packages/sense/native/src/journey_compose.rs`](../../../packages/sense/native/src/journey_compose.rs),
[`packages/core/src/attribute/subject-pieces.ts`](../../../packages/core/src/attribute/subject-pieces.ts),
[spec 0099](../../specs/0099-a-mock-is-a-declared-subtraction.md) (what a mock
subtracts)

## Context

A test of a checkout flow enters the cart total, and the cart total has a test
of its own. A page story renders the footer, and the footer has a story of its
own. Both suites hold the same question: what does the larger subject check
that the smaller ones inside it do not? Asked of every pair, it names the tests
whose every finding a narrower test already makes, and the places only one
broad test watches.

The recording already holds, per test case, the regions it entered, and the
composition section already holds, per story, the component renderings it
contains. Neither was read against itself one subject at a time. The census
runs component-first, and the echo list that names shared renderings is capped,
so a reader could not subtract one subject from another without the snapshots.

## Decision

**One algebra over two kinds of footprint: a subject is its footprint less
structure, its pieces are the smaller subjects nine tenths inside it, and what
no piece covers is listed place by place.**

- **Footprint.** A test's footprint is the regions it entered; a story's is the
  distinct renderings it holds, a component and the digest of what it
  rendered. Both are sets, so subtraction is set difference.
- **Structure.** A region more than half the suite entered, or a component more
  than half the subjects mount, is structure and counted apart. Without it
  every page holds every story through its theme provider, and every test holds
  every test through its setup file. A component counts once per subject
  however often that subject mounts it: twenty chips on one page are one
  subject's vote, not twenty.
- **Pieces, wholes, alike.** A piece is a smaller subject with at least nine
  tenths of its footprint inside this one's; a whole is a larger one holding at
  least nine tenths of this one's; a subject with exactly this footprint is
  alike and named apart. Nine tenths rather than all, so one rendering or one
  region of difference does not hide a piece.
- **The residue splits by what a piece already reached.** A test's residue is
  `own`, modules no piece entered, and `reached`, regions of a piece's module
  that only this test enters — paths a narrower test would reach more cheaply.
  A story's residue is `own`, components no piece mounts, and `inContext`,
  components a piece mounts and this subject renders otherwise — a state only
  the larger subject shows. The split is the answer: `reached` is a test to
  move down, `inContext` is a rendering to keep up.
- **Where it is computed.** The test side is computed at question time in the
  sense addon from the recording (`docs_test_composition`, `variance ask
  test-composition`). The story side is computed once per run over every
  composed subject, by `piecesOf`, and carried per subject in the report's
  structure section beside its rows, read back by `variance_composition
  {subject}`.

## Alternatives

- **Subtract whole subjects pairwise.** B − A for every pair is quadratic in
  output and names nothing a reader can act on; containment picks the pairs
  worth naming.
- **Exact containment.** One extra region in the smaller test — a helper only
  it calls, a fixture only it builds — and the narrower test stops being a
  piece of the test it sits inside. The tenth is not measured; it is the
  smallest tolerance that keeps a one-region helper from hiding a piece in the
  fixtures, and it is a constant on each side to move when a real suite argues for
  another.
- **Structure counted per mount.** A component mounted twenty times in four
  subjects of nine became structure, and the chip story stopped being an
  example of the chip. Counting subjects is what *most of the suite* means.
- **Derive pieces from the echo list at read time.** The list is capped and
  what it left out is counted, not kept, so a reader would compute pieces over
  a sample.

## Consequences

A subject its pieces cover entirely is not therefore redundant: the arrangement
between the pieces — the call order in a test, the layout between components on
a page — is not a region or a rendering of any one of them. The answer says what
is covered and leaves deletion to the reader.

The algebra reads execution. A test that mocks a module enters none of it, so a
mocking test lists no piece for what it mocked and its residue holds only its
own code. Whether that is acceptable is a question about the mock, not the
recording, and is [spec 0099](../../specs/0099-a-mock-is-a-declared-subtraction.md).
