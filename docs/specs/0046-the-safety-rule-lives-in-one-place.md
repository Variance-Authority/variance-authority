# Spec 0046 — the rule that makes a skip list safe is written once, in the library

**Missing:** an enforced contract between the record and its answer. The rule
that keeps a skip list safe — subtract only when nothing is unread, and never
trust a row whose text has moved — is written four times, in four dialects,
across four callers, and the library that owns the record disclaims it. Two of
its exported functions hand out `entered` with neither `whole` nor `unread`
beside it, which is the one shape from which a caller can build an unsafe
answer without noticing.
**Built on:** [0045](0045-a-snapshot-states-its-own-age.md) (the refusals a
query must be able to tell apart),
[ADR-0062](../context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md),
[ADR-0059](../context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md).

## Purpose

Every other spec in this set is about a record that costs too much or says too
little. This one is about the moment the record is believed.

`ExecutionNarrowing` returns four sets — `whole`, `entered`, `unread`, `stale`
— and a safe answer is a function of all four. The library computes all four
correctly and then leaves the function to its callers, who have each written it
themselves: `variance select`, `variance run --since`, `tools/test-since.mjs`,
and the README. A fourth exported surface hands out `entered` alone. **The
sentence the entire feature rests on is not a line of shipped code anywhere.**

That would be a tidiness complaint if the four agreed. They do not:

- `tools/test-since.mjs` narrows `unread` before deciding, with a
  hand-maintained list of inert path prefixes and a test-file exemption.
  Nothing checks that list against what the suite actually opens, and an entry
  that is wrong removes the guard for everything under it.
- `variance select` never passes `relations`; `variance run --since` does. Two
  callers of one library run with the importer walk on and off, and nothing
  reconciles them — the same diff against the same snapshot yields two different
  skip lists depending on which command asked.
- `knownAs` is supplied only by `tools/test-since.mjs`. The CLI's reader passes
  `sourceAt` and `relations` and nothing else.
- Only `tools/test-since.mjs` intersects `whole` with the suite that was
  actually collected. `variance select` subtracts from `whole` directly — so
  deleted tests, renamed tests, and tests belonging to another project or
  another config are all in the answer.

And the frame check contradicts its own documentation in the direction that
misleads an operator. `textAtRecording` returns `undefined` when the snapshot
names no commit, with a docblock at `recorded-text.ts:111-113` saying this
avoids "reporting every module stale". `recorded()` at `test-selection/select.ts:333` reads
`undefined` as disagreement and returns `false`. **A commitless snapshot
therefore reports exactly every changed module stale** — the widening is safe,
and the operator is told N modules "were recorded from a different text" and
advised to record once over a clean tree, which cannot fix a missing commit.
The same shape sits one layer down: the batched `git cat-file` read swallows
every failure — no git on PATH, not a checkout, a shallow clone, an unknown
commit — and returns an empty map, which every path reads as disagreement.

## What would discharge it

**1. The safe answer is a function in the library, and it is the only way to
get one.** One exported entry takes the narrowing and the collected suite and
returns the files to skip, applying the guard and the intersection itself. The
four hand-written versions are deleted, the README quotes the function rather
than restating the rule, and the two surfaces that hand out `entered` alone
either hand out the whole narrowing or are removed.

**2. The narrowing cannot express a state its callers mishandle.**
`whole: []` beside a non-empty `entered`, and a non-empty `unread` beside a
non-empty `entered`, are both constructible today and both mean *do not
subtract* — which a caller reading only `entered` cannot see. The type makes
the unsafe combinations unrepresentable, or the constructor rejects them.

**3. The frame check says what it found, and its failures are typed.** Three
conditions arrive today as one `undefined`: *the snapshot names no commit*,
*the position could not be read at all*, and *the text at that commit differs*.
The first two are not staleness; they are an absent instrument. Each gets its
own answer, each widens as it must, and each produces advice an operator can
act on. `readDiff` is guarded rather than letting every escape be misreported
as a corrupt snapshot with destructive advice.

**4. One frame check, in one unit.** The library asks per module name;
`tools/test-since.mjs` carries its own `outOfFrame` / `inSnapshotCoordinates`
because a workspace `dist` name is not a path git can answer. Wiring `knownAs`
into the CLI as it stands *breaks* the library's check for exactly that reason,
and the library has no answer for it. The name a row carries and the path a
diff carries are two coordinate systems, and the translation between them
belongs beside the check, once.

**5. The record's own precision is used.** Per-region digests exist in the
format and selection reads none of them: the frame check is whole-module and
all-or-nothing. `answerByImporters` selects every test that entered *any*
region of a reached module, so the per-region narrowing that is the point of the
record is not applied on the importer path at all. A precondition's recorded
digest is never compared at query time, so a file answered only by a
declaration is never frame-checked. `loadedBy` — which tests had already
entered a region before their first test ran — is recorded, encoded, folded,
decoded, and then read only by the ranking layer.

**6. The query re-asks what the write path already guards.** The
`instrumentation` recipe on the snapshot is never checked at query time, so a
record made under a coarser mode is believed exactly as a branch-level one.
Nothing distinguishes a snapshot whose `whole` set predates the diff base from
one recorded at it. Generations guard the write path
([0044](0044-many-writers-one-record.md) item 3); the read path does not ask.

**7. A narrowing that is truncated says so.** `--at-distance` cuts the run to a
hop band and drops tests the snapshot positively says the diff reached. That may
be what an operator wants, and it is not a skip list — it is a selection *over*
one, and the two must not be reported by the same channel or the same exit code.

**8. The holes are marked at the site.** `bindsOnly` has a self-documented
residual — added text is parsed with no frame, so a line inside a template
literal that happens to parse as an erased construct charges nobody — and it is
applied to added text only, so a *removal* of an erased construct still charges
the enclosing region. `select.ts` acknowledges an over-selection. Neither
carries an `it.todo` or a `// FIXME`, which is how this repository is supposed
to say a thing is unfinished, and the answer stage has no row in
`docs/instruments.md` at all.

**Acceptance:** a property test over generated diffs and generated snapshots
asserting the one invariant that matters — *every test the record does not
witness as unaffected is in the answer* — replacing the per-shape unit fixtures
as the safety argument. Then `variance select` and `variance run --since`
producing the same skip list for the same diff and snapshot. Then a commitless
snapshot, a snapshot outside a checkout, and a shallow clone each producing a
distinct diagnostic naming what is missing and what to do.

## What it forecloses

**No caller reconstructs the rule.** A surface that returns `entered` without
`whole` and `unread` is a surface that invites an unsafe skip list, and shipping
one is not made acceptable by documenting the rule beside it.

**Widening is not a substitute for knowing.** Every rule here that widens keeps
its licence to widen. What it loses is the option of widening for an
unestablished reason and reporting it as an established one — a missing
instrument is not a stale module.

**A hand-maintained exemption list is not a contract.** Prefixes that disable
the guard for a subtree may exist as a measured, tested policy inside the
library; they may not exist as a literal in a script, checked by nobody.

**Ranking is not selection.** `loadedBy`, hop distance and ordering explain and
prioritize a run. Nothing in this spec permits any of them to remove a test from
one ([the module-level rule](0029-what-a-run-remembers.md) is unchanged).
