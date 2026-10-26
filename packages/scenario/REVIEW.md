# Reviewing `@variance-authority/scenario`

Records an Arrange–Act–Assert run as a witnessed path through named states,
compares two paths and folds many into a partial machine. A harness performs the
acts and hands it `SemanticSnapshot`s; `core` compares them. The optional
archive keeps the snapshots on disk.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/scenario/`.

## Contracts

Unless a test is named, each is written in
[ADR-0047](../../docs/context/adr/0047-a-runtime-scenario-is-a-witnessed-path.md);
tests are in [src/scenario.test.ts](src/scenario.test.ts).

- **It records and compares, and decides nothing.** No gate, baseline, history
  row or exit code; the root entry does no I/O. Also in [README › What this is
  for](README.md#what-this-is-for).
- **Three variances stay three.** Arrange, each act's effect and the divergence
  between effects are typed apart; an effect is the variation digest, not the
  render hash. Pinned by › "keeps Arrange variation separate while equal
  transition effects agree".
- **Acts align by `(key, occurrence)` on the common prefix, never shifted.**
  Pinned by › "stops alignment at an inserted Act and reports every unmatched
  identity" and "refuses a shifted ordinal instead of guessing which authored
  Act it meant".
- **An unobserved outcome ends the path**, and `firstDivergence` is
  `unresolved`, never `none`. Pinned by › "terminates at an unobserved outcome
  and refuses synthetic later frames".
- **A blind side is named, never agreement.** Pinned by › "names the
  profile-blind side rather than reporting absent geometry as equal".
- **An unread cause is `unread`, never a flake.** Pinned by › "says the reading
  was not made when no fiber was read".
- **A fold keeps every witnessed edge and invents none.** Pinned by › "joins
  converged states and preserves two destinations for one state and Act" and
  "keeps an unobserved Act as unknown rather than inventing an edge".
- **A precondition link is carried, never inferred.** Also in
  [README](README.md#record-two-paths-and-compare-them).
- **The archive admits before it writes, and never reconstructs.** A refused
  snapshot is neither written nor redacted, expired or missing evidence is
  `unobserved`, and collection keeps what a retained manifest names. Written in
  [ADR-0048](../../docs/context/adr/0048-a-scenario-archive-holds-semantic-objects.md);
  pinned by [src/archive.test.ts](src/archive.test.ts) › "refuses a semantic
  snapshot that retention policy cannot admit" and "reports expired evidence as
  unobserved and garbage-collects its objects".

## Where to look for a counterexample

- `src/assessment.ts`: a repeated key whose occurrences differ by side, and an
  unobserved frame on one side only.
- `src/machine.ts`: a forged run whose frames cross a terminal outcome.
- `src/archive.ts`: a refusal on a later frame after earlier objects were
  written; a collection while another manifest still names an object.

## Not this package's

- A digest spelled as a file name: `digestFileName` in `core`. What a band or a
  parting slice means: `@variance-authority/core/compare`.
