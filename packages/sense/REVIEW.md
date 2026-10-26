# Reviewing `@variance-authority/sense`

`sense` records which test entered which region of which module, and answers a
diff with the tests it reached and the tests the record speaks for.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/sense/`.

## Contracts

- **A skip is `whole` less `entered`.** Only a complete observation is in
  `whole`; one `unread` path runs everything. Written in
  [ADR-0062](../../docs/context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md).
- **A stage asked alone answers as it does inside the whole.** By hand, `ignore`
  cuts the change first and the preconditions read all of it; no stage selects
  more for what it leaves `unanswered`. Written in
  [README](README.md#ask-one-stage-alone) and pinned by
  [composed-stages.test.ts](src/test-selection/composed-stages.test.ts) ›
  "charges a file handed over under two of its names once, as the composition
  does".
- **An unreadable record is absent, never a record of nothing.** A missing,
  corrupt or foreign-layout snapshot costs a full suite. Written in
  [README](README.md#where-the-snapshot-lives-and-when-it-is-rebuilt).
- **Absence selects nothing.** A module with no row selects nothing unless
  `relations` and `sourceAt` let its nearest measured importers answer; a chain
  ending where the record never looked selects nobody, and a `type` edge or a
  mock cuts a walk. Written in [README](README.md#what-selects-what).
- **A precondition is unconditional.** A row on the declared file narrows
  nothing. Written in ADR-0062 and pinned by
  [select-unread.test.ts](src/test-selection/select-unread.test.ts) › "runs a
  test that declares a changed file it entered nothing of, row or no row".
- **What cannot be read is charged, never dropped.** A diff that does not apply,
  a text that does not parse or a host with no scanner charges lines and says
  why in `readings`; a row cut from another text is `stale`, charged whole.
  Pinned by [index.test.ts](src/test-selection/index.test.ts) › "charges the
  module whole, and names it, when it does not".
- **The TypeScript reader is the native side's oracle.** Written in
  [ADR-0065](../../docs/context/adr/0065-source-scanning-is-one-native-side.md)
  and pinned by [native-update.test.ts](src/native-update.test.ts) › "publishes
  what the JavaScript update publishes after an edit".
- **A name is a checkout-relative path; another name is another file.** Only
  `knownAs` relates names, and two builds of one file keep two rows. Pinned by
  [lookup.test.ts](src/test-selection/lookup.test.ts) › "returns both rows when
  two builds read one file, not the one a search landed on".
- **Two checkouts never share bytes.** A worktree reads both layers and writes
  its own; once a suite is declared, a seam naming none stops. Pinned by
  [cache-layers.test.ts](src/test-selection/cache-layers.test.ts) › "a worktree
  reads its own layer first and the repository second".

## Where to look for a counterexample

- `src/test-selection/`: an ignored file a `/// <depends>` reads, lines with no
  hunks, a built twin, and a name-filtered Jest run that must stay partial.

## Not this package's

- The install and harness stages: `@variance-authority/core/relate`.
