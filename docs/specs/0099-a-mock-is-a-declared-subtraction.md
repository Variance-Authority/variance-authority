# Spec 0099 — a mock is a declared subtraction

**Missing:** what a test's composition says when the test mocks its pieces. A
test of `B` that mocks `A` enters none of `A`, so `A`'s tests are not its
pieces, and `B − A` is all of `B`. The recording is right — `B`'s test never ran
`A` — and the answer is incomplete: whether `B`'s test may skip `A` depends on
whether anything checks that `A` behaves the way the mock says it does, and
nothing reads the mock.
**Built on:** the test side of
[ADR-0086](../context/adr/0086-a-subject-is-read-as-the-narrower-subjects-inside-it.md)
— footprint, pieces, wholes and the `own`/`reached` residue, computed in the
sense addon from the recording — and the mock shadows the relation graph
already carries per test file, which `test-selection/shadowed.ts` holds against
the record so a test's load-time crossings into a module it mocked are not
read as entering it.

## Purpose

A mock is a subtraction the author declared instead of one the recording
measured. Reading it as one turns three cases a reviewer argues about into
three answers:

- **Verified.** `A` is mocked in `B`'s test, and `A`'s own tests enter the
  regions of `A` that `B` calls with the inputs the mock answers for. The mock
  stands in for a piece that exists. `B − A` is `B`'s own code, and that is
  what it should be.
- **Half verified.** `A` has tests, and none of them enters the path `B` calls.
  The mock answers for behaviour nobody checks.
- **The mock is the only witness.** Nothing enters `A` at all. The only
  statement about `A` in the suite is the one the mock makes, and it is not a
  test of `A`.

## Requirements

1. A test's composition names each module its file shadows, from the shadows
   the relation graph carries — the same set selection reads — so the two
   answers cannot disagree about what was mocked.
2. Each mocked module is classified as one of the three cases above, from the
   recording alone: which tests entered it, and which of its exported functions
   they entered.
3. A mocked module is never a piece and never residue. It is its own part of
   the answer, after the wholes.
4. A mock of a third-party module or of structure is listed and not classified.

## Open

- A shadow is per test file, and a case may restore the original inside it.
  What a case entered it really entered, so a restored module is a piece of
  that case and a mock of its siblings; the classification is per case or it
  is wrong for one of them.
- Whether *the path `B` calls* is read at function grain or region grain.
