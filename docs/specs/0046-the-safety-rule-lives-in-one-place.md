# Spec 0046 — the rule that makes a skip list safe is written once, in the library

**Missing:** an enforced contract between the record and its answer. The rule
that keeps a skip list safe — subtract `entered` from `whole` and from nothing
else, and never trust a row whose text has changed — is written four times, in
four dialects, across four callers, and the library that owns the record
disclaims it. Two of its exported functions hand out `entered` with no `whole`
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
— and a safe answer is `whole` less `entered`. `stale` is already charged into
`entered`, and `unread` names the changed paths the record says nothing about,
which select nothing and are reported. The library computes all four correctly and
then leaves the subtraction to its callers, who have each written it
themselves: `variance select`, `variance run --since`, `tools/test-since.mjs`,
and the README (`packages/sense/README.md:717`). A fourth exported surface
hands out `entered` alone. **The sentence the entire feature rests on is not a
line of shipped code anywhere.**

That would be a tidiness complaint if the four agreed. They do not:

- `variance select` always scans and passes `relations`; `variance run
  --since` passes them only when `source.relations` is set. Two callers of one
  library run with the importer walk on and off, and nothing reconciles them —
  the same diff against the same snapshot yields two different skip lists
  depending on which command asked. Without the walk a changed stylesheet is
  `unread` rather than answered by its measured importers, and selects nothing.
- `knownAs` is supplied only by `tools/test-since.mjs`. The CLI's reader passes
  `sourceAt` and `relations` and nothing else.
- Only `tools/test-since.mjs` intersects `whole` with the suite that was
  actually collected. `variance select` subtracts from `whole` directly — so
  deleted tests, renamed tests, and tests belonging to another project or
  another config are all in the answer.

And the frame check contradicts its own documentation in the direction that
misleads an operator. `textAtRecording` returns `undefined` when the snapshot
names no commit, with a docblock at `recorded-text.ts:111-113` saying this
avoids "reporting every module stale". `frameOf` at
`test-selection/reading.ts:107` reads `undefined` under every name as
disagreement and answers `stale`. `tools/test-since.mjs` withholds `sourceAt`
from a commitless snapshot; the CLI does not. **Through `variance select` and
`variance run --since`, a commitless snapshot therefore reports exactly every
changed module stale** — the widening is safe,
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

**2. The unguarded shape is not exported.** The four sets are each legitimate
on their own — `whole: []` beside a non-empty `entered` means no test file was
observed whole. What is not legitimate is a surface that hands a caller
`entered` without `whole`, the set that bounds what subtracting from it may
remove. Either those surfaces return the whole narrowing,
or they return the answer itself and not its inputs. A caller that never holds
a partial narrowing cannot build an unsafe one.

**3. The frame check says what it found, and its failures are typed.** Three
conditions arrive today as one `undefined`: *the snapshot names no commit*,
*the position could not be read at all*, and *the text at that commit differs*.
The first two are not staleness; they are an absent instrument. Each gets its
own answer, each widens as it must, and each produces advice an operator can
act on. `readDiff` is guarded rather than letting every escape be misreported
as a corrupt snapshot with destructive advice.

**4. One translation between names and paths.** The frame check is one unit,
`frameOf`, asked under every name `knownAs` gives a file, and a built twin's
rows are in frame when the source's are. What is still written twice is the
translation: `tools/test-since.mjs` rewrites a diff with `inSnapshotCoordinates`
before the library sees it, and the CLI's reader supplies no `knownAs` at all.
The name a row carries and the path a diff carries are two coordinate systems,
and the translation between them belongs beside the check, once.

**5. The record's own precision is used.** Per-region digests exist in the
format and selection reads none of them: the frame check is whole-module and
all-or-nothing. A precondition's recorded digest is never compared at query
time, so a file answered only by a declaration is never frame-checked.
`loadedBy` — which tests had already entered a region before their first test
ran — is recorded, encoded, folded, decoded, and then read only by the ranking
layer.

The importer path is the exception, and the position needs writing down rather
than fixing. `answerByImporters` selects every test that entered *any* region of
a reached module, and it must: a module reached through an importer has no
changed line of its own, and the record holds no reverse relation from a region
to the regions that reach it — by
[ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md)
the relation is interned per test, scanned, and never stored inverted. Narrowing
there would be inventing evidence the record does not hold. Say so where the
widening happens, so the next reader does not file it as a missed optimization.

**6. The query re-asks what the write path already guards.** The
`instrumentation` recipe on the snapshot is never checked at query time, so a
record made under a coarser mode is believed exactly as a branch-level one.
Nothing distinguishes a snapshot whose `whole` set predates the diff base from
one recorded at it. The same hole has a second edge the write path already names
and the read path cannot see: `usableOutcome`
(`test-selection/finished-files.ts:125`) counts a skip as a usable outcome, and
its docblock states the boundary — a skip decided outside the source, by an
environment variable or a platform check, is not covered. A record made where
that condition was true is applied where it is false without a word, because the
record carries nothing the query could compare it against. Generations guard the
write path
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

**9. The frame is checked against the frame the diff is in.** `frameOf`
asks `sourceAt(name, coverage.commit)` (`test-selection/reading.ts:97`) — the
text as of the *snapshot's* commit. The hunks it is deciding about are line
ranges in the *diff base's* coordinates. The two coincide only while the
snapshot was recorded at the base, which is the local case and not the CI one:
a snapshot recorded on a `main` that has since moved maps base-coordinate hunks
onto snapshot-coordinate regions, and a line that has shifted charges the wrong
region — or no region. **The failure direction is narrowing**, and no refusal
fires, because every module's text still agrees with itself at the commit it was
recorded at. Either the query takes the base as a parameter and checks against
it, or it refuses a snapshot whose commit is not an ancestor of the base and
says which.

**Acceptance:** a property test over generated narrowings asserting the algebra
the one entry point implements — `skip` is a subset of `whole`, `skip` and
`entered` are disjoint, and `unread` never changes `skip` —
replacing the per-shape unit fixtures as the argument that the *rule* is
applied. That the rule is the *right* rule is not a property a test can
establish against the implementation that defines it: the measurement that
argues it is [0047](0047-a-skip-list-is-worth-what-it-skips.md)'s, over real
revisions where the run answers whether a skipped test would have failed. Then
`variance select` and `variance run --since`
producing the same skip list for the same diff and snapshot. Then a commitless
snapshot, a snapshot outside a checkout, and a shallow clone each producing a
distinct diagnostic naming what is missing and what to do. Then a snapshot
recorded two commits behind the diff base, where either every changed line is
charged to the region it lands in at the base or the query refuses.

## What it forecloses

**No caller reconstructs the rule.** A surface that returns `entered` without
`whole` is a surface that invites an unsafe skip list, and shipping
one is not made acceptable by documenting the rule beside it.

**Widening is not a substitute for knowing.** Every rule here that widens keeps
its licence to widen. What it loses is the option of widening for an
unestablished reason and reporting it as an established one — a missing
instrument is not a stale module.

**Ranking is not selection.** `loadedBy`, hop distance and ordering explain and
prioritize a run. Nothing in this spec permits any of them to remove a test from
one ([the module-level rule](0029-what-a-run-remembers.md) is unchanged).
