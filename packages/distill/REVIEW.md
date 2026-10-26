# Reviewing `@variance-authority/distill`

`distill` answers what one test, or one test file, loaded but never used, by
subtracting what the test addressed (Eyes journals) or what its cases entered
(the case index) from what the run loaded.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/distill/`.

## Contracts

- **The case is joined by exact id.** A case is found by its id or whole title,
  the file by its exact path, never by a part; an unheld id is refused with the
  ids the record holds. Written in
  [README](README.md#one-id-joins-the-two-readings) and pinned by
  [index.test.ts](src/index.test.ts) › "names a test by its id or whole name,
  never by a part of either".
- **Missing attention is not an empty surface.** A record without Eyes, an
  unwatched case and a watched case with no journal are three things, none a
  measured-empty surface. Pinned by [index.test.ts](src/index.test.ts) › "does
  not turn missing attention into an empty addressed surface".
- **An unfinished reading is withheld, with its reason.** A case that stopped or
  did not say it finished, or an incomplete row, gives `withheld`. Pinned by
  [file.test.ts](src/file.test.ts) › "withholds the reading when a case stopped,
  or did not say whether it finished".
- **Loaded-only means the top level ran and nothing below it did.** A run at
  load is a use, never a mock. Pinned by [charge.test.ts](src/charge.test.ts) ›
  "reads a function the file calls while it loads as a reference at load, not as
  one a case ran".
- **A substitution names the module, and never where it cannot hold.** No mock
  is proposed when the exports are unknown or something the subject runs reads
  the import. Written in
  [spec 0097](../../docs/specs/0097-a-consumer-pays-for-what-it-loads.md) and
  pinned by [charge.test.ts](src/charge.test.ts) › "proposes no mock where a
  case runs, or the subject hands on, what reads the import".
- **An import is charged once.** A module two used imports reach goes to
  neither. Written in
  [spec 0095](../../docs/specs/0095-an-import-spills-what-the-test-never-used.md).
- **Order is deterministic.** Pinned by [scope.test.ts](src/scope.test.ts) ›
  "answers the same whatever order the record lists its modules in".

## Not this package's

- How the case index is written or read natively: `@variance-authority/sense`.
