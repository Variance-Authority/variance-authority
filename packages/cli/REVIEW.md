# Reviewing `@variance-authority/cli`

The `variance` binary: `covering` names the cases that ran a line or a diff,
`review` says what a change did for the person merging it, and `select` names
the test files a runner may skip, each read from what `sense` recorded.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under `packages/cli/`.

## Contracts

- **Nothing recorded is refused, never empty.** A missing index exits `2`, with
  `{"refused":"unrecorded"}` under `--format json`. Written in [the covering
  reference](skills/variance-authority/references/covering.md#nothing-recorded-is-refused-not-empty).
- **A path is the file asked, and silence says which.** A recorded namesake is
  another file; `unrecorded`, `unloaded` and `older` are three answers, and an
  unreadable record is never "never loaded". Written in [README ›
  Covering](README.md#covering-which-tests-covered-this-line).
- **State is read over every case, before any narrowing.** `hole` is unknown,
  never untested; `--where` and `--at-distance` drop cases, never change a
  state, and count a test the walk could not place out. Written in [README ›
  Narrowing](README.md#narrowing-the-answer-to-what-is-nearby).
- **Text the record cannot place gets no range.** A `stale` frame names the
  cases and no line numbers. Written in [README › The text you
  hold](README.md#asking-about-the-text-you-hold).
- **Motion is compared or refused, never guessed.** A base with no commit, or
  one the clone lacks, exits `2`; a stopped case is `hidden`, never `lost`.
  Written in [README › What a change moved](README.md#what-a-change-moved).
- **A review starts where git says and compares only what a run replaced.**
  Without `--since` it starts from the runs record, refused naming the commit to
  fetch when git cannot tell; a second run at one commit sets `motion.undiffed`;
  an unmeasured distance is not far and a missing record is not zero. Written in
  [README ›
  Review](README.md#review-what-a-change-did-for-the-person-merging-it).
- **`select` prints a skip list.** Paths alone on stdout, sentences on stderr;
  an answer that cannot narrow prints nothing, so the suite runs. Written in
  [README › select](README.md#select-what-your-own-runner-may-skip) and
  [ADR-0062](../../docs/context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md).
- **Absence selects nothing.** A changed path no record measured is named and
  widens nothing. Written in [spec
  0091](../../docs/specs/0091-a-suite-is-selected-by-a-machine.md#what-would-discharge-it),
  item 5.
- **Legs partition the selection, from the record's commit.** Every selected
  file runs once in a loop of legs covering every hop; the diff's line numbers
  are the record's commit's. Written in README › select.

## Where to look for a counterexample

- `src/commands/covering-suites.ts`, `covering-unloaded.ts`: a refusal kind
  swapped under an unreadable record, a shallow clone, or a namesake.
- `src/commands/covering-reach.ts`, `covering-where.ts`: a state read after a
  filter, or an unplaced test counted near.
- `src/commands/runs-base.ts`, `suite-base.ts`: a shallow clone, a branch-line
  record, a second run at one commit.
- `src/commands/select-command.ts`, `select-leg.ts`: a sentence on stdout, or a
  leg loop that drops or doubles an unplaced test.

## Not this package's

- How a line is charged, a region's state, the skip arithmetic:
  `@variance-authority/sense` (`chargeLine`, `narrowByExecution`).
