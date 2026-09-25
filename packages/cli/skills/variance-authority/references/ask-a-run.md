# Ask a finished run

`variance ask` answers from the report the last run wrote, at the config's
`report` path (default `.variance/report.json`, resolved against the config
file's directory). It needs no server, no MCP client and no connection. Each
answer is the text an MCP client gets from the same function, so nothing is lost
by asking from the shell.

## Check before the first question

1. **A run has finished.** No question re-runs anything, so an absent report is
   an absent answer, not a stale one.
2. **The checkout is at the revision the run was made at.** `locate --from` and
   `--to` read the working directory, not the report. `summary` names the
   commit the run's index stands at and how many files differ from it.
3. **The build kept `file:line`.** A production build strips the line, and a
   build with owner links stripped has an empty `createdBy` everywhere. Both
   make `locate` and `describe` less precise without failing.
4. **Retention is not `ephemeral`** if the run must stay answerable after the
   process that made it. An ephemeral run answers while its report file exists,
   and keeps no images.
5. **The suite is React** if you need update initiators or `createdBy`.
6. **`@variance-authority/sense` is installed** if you will pass `locate --from`
   or `--to`. It is the package that reads the source tree; without it the
   question is refused in one sentence. `locate` without a start point does not
   need it.

```bash
variance ask                          # the questions, and what each one answers
variance ask summary                  # start here; every other question takes an id it prints
variance ask changes                  # the distinct changes behind the changed subjects
variance ask composition              # what explains each movement; flake vs suspect
variance ask describe --subject <id>  # one subject: regions, components, files, fingerprints
variance ask locate --query "<words>" # the subject you can only describe, by the names the run saw
```

## Ask `summary`, then `changes`

These two are unconditional, in this order.

**`summary`** gives verdict counts, the subjects that need attention, and the
subjects that were not observed at all. Unobserved is not unchanged. Its shape
is the shape of every answer — counts, then subjects, then what was not
observed:

```
3 subject(s) observed, ephemeral run at 2026-09-17T21:23:34.804Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
3 changed
observed everything — the execution index stands at 30783c2f…, 7 file(s) differ from it

[changed] card/summary — Button: 3,402 pixels differ across 2 regions in Button, Avatar
[changed] badge/standalone — Badge: 1,017 pixels differ across 1 region in Badge

coverage: every planned subject was observed.
findings: none in 3 inspected subject(s).
```

**`changes`** groups changed subjects into distinct changes: a token edit that
touches forty stories is one change, not forty. Ask it before any question about
one subject, because it decides how many of the remaining questions are worth
asking. Each change names the component, its `file:line`, how many subjects it
changed, and the `variance accept --shape` digest that settles it:

```
3 subject(s) changed, and they are 3 distinct change(s) — 2 of which can be decided in one action

Button
  examples/agent-claim/src/system.js:28
  reaches 2 subject(s); it is the whole change in 1
  in the other 1, something else also moved, so accepting this shape there would
  promote a difference nobody reviewed
  5650 pixel(s): card/summary, card/compact
  variance accept --shape v1:203640236f6a486afeca1e45f656e4dd
```

## Ask the rest only when the condition holds

- **`adjudicate --claims <path>` — if you made the edit, and before you read the
  diff.** Declare what you meant to change; the claims file format is below.
  Its answer *declared, and did not happen* is how you learn an edit never
  landed, which no comparison of images can tell you. Claims copied out of
  `changes` score the run against itself and are worthless. This is its own
  command, `variance adjudicate --claims <path>`, not an `ask` question, and it
  exits `1` when a claim is unmet.
- **`composition` — before calling anything flaky**, and when a change has no
  obvious author. It names what explains a movement, and separates `flake`
  (read twice, differed) from `suspect` (never read twice).
- **`locate --query <words>` — when you can describe the subject but do not have
  its id.** See [locate](locate.md). `composition --subject <id>` then says what
  that subject is made of.
- **`describe`, `explain-verdict`, `trace-component`, `findings` — once you know
  which subject or component matters.** Ask them one at a time. Ask
  `explain-verdict` when a subject was not compared at all: it separates
  `incomparable` (a baseline exists, another machine rendered it) from `new` (no
  baseline) from never observed.
- **`changelog` — before proposing an accept, and never after.** It previews
  what acceptance would write down.

## `ask diff` has two subjects

The flag decides which. With `--at <address>` it asks a watcher what changed
since the last reading that watcher handed out: the progress question, in
[live run](live-run.md). Without it, it compares the report with the state the
previous successful `ask` recorded beside it, in `asked.json` in the report's
directory: the re-run question. The first call of either records state and has
nothing to compare:

```
The current state matches the previous invocation.
```

## Declare before you read: the claims file

`--claims <path>` is JSON, and it is the one argument with no default: it is
what you meant to change, and nothing can infer that. It is a bare array or
`{"claims": [...]}`. Each claim has a `root` (`component:Button`,
`shape:<fingerprint>`, or a bare component name), a `reason` in your own words,
and an optional `maxSubjects` bound. `reason` is required because the answer a
reviewer reads repeats it.

```json
{
  "claims": [
    { "root": "component:Button", "reason": "new brand accent on the primary action", "maxSubjects": 1 },
    { "root": "component:Badge", "reason": "new brand accent on the status pill" },
    { "root": "component:Card", "reason": "tighten the gap between the avatar and the action" }
  ]
}
```

An empty array is refused rather than adjudicated, because "0 claims, 0
undelivered" reads as reassurance. A file that does not parse is refused for the
same reason.

```bash
variance adjudicate --claims claims.json
```

```
An edit you declared did not take. Fix that before reading anything else.
4 claim(s): 1 delivered, 1 undelivered, 1 over-reaching, 1 unchecked. 1 unclaimed change(s).

  [undelivered] component:Card
      declared (tighten the gap between the avatar and the action) and `Card` rendered in
      2 subject(s) — card/summary, card/compact — and did not change. The edit did not take:
      wrong file, a dead branch, a rule something else overrides, or a stale build.

  [unobservable] component:Tooltip
      declared (arrow follows the new accent) and this run never rendered `Tooltip` in any
      subject, so nothing here is evidence about it either way.

  [overreached] component:Button
      declared (new brand accent on the primary action) and delivered, but reached
      2 subject(s) against the 1 declared — the change is the intended one, its reach is not.
      examples/agent-claim/src/system.js:28

  [unclaimed] Avatar
      Avatar moved and no claim covers it — 1 subject(s), 577 pixel(s), nothing it can settle
```

There are five verdicts. `unobservable` is not `undelivered`: the first says the
run never looked, the second says it looked and nothing changed.
