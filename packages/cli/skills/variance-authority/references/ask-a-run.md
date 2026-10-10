# Ask a finished run

`variance ask` answers from the report the last run wrote, at the config's
`report` path (default `.variance/report.json`, resolved against the config
file's directory). When that file is absent, it reads the shared report instead
— your branch's line, then the mainline's — and the answer names where it read.
It needs no server, no MCP client and no connection. Each answer is the text an
MCP client gets from the same function, and it is text only: `--format json` is
refused on every question but `search`.

## Check before the first question

1. **A run has finished.** No question re-runs anything. `report`,
   `adjudicate`, `comment` and `push` refuse when the configured report is
   absent; only `ask` falls back to the shared one.
2. **The checkout is at the revision the run was made at.** `locate --from` and
   `--to` read the source tree in the working directory, not the report, and
   are refused when no source tree was read. `summary` names the commit the
   run's index stands at and how many files differ from it.
3. **The build kept `file:line`.** A production build strips the line, and a
   build with owner links stripped has an empty `createdBy` everywhere. Both
   make `locate` and `describe` less precise without failing.
4. **Retention is not `ephemeral`** if the run must stay answerable after the
   process that made it. An ephemeral run answers while its report file exists,
   and keeps no images.
5. **The suite is React** if you need update initiators or `createdBy`.

`variance ask` with no question lists every question and its flags.

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
observed everything — the execution index stands at 30783c2f…, 7 file(s) differ from it; `variance run --since 30783c2f…` observes only what those reach

[changed] card/summary — Button: 3,402 pixels differ across 2 regions in Button, Avatar
[changed] card/compact — Button: 2,825 pixels differ across 1 region in Button
[changed] badge/standalone — Badge: 1,017 pixels differ across 1 region in Badge

coverage: every planned subject was observed.
findings: none in 3 inspected subject(s).
```

A reason several subjects share is printed once, under a count, with the
subjects it covers listed beneath it. An upgrade that moves the identity key
reads as one line, `[incomparable] 4697 subjects: …`, not as four thousand
copies of it.

**`changes`** groups changed subjects into distinct changes: a token edit that
touches forty stories is one change, not forty. Ask it before any question about
one subject, because it decides how many of the remaining questions are worth
asking. Each change names the component, its `file:line`, how many subjects it
changed, and the `variance accept --shape` digest that settles it.
`--component <name>` keeps the changes attributed to that component:

```
3 subject(s) changed, and they are 3 distinct change(s) — 2 of which can be decided in one action

Button
  examples/agent-claim/src/system.js:28
  reaches 2 subject(s); it is the whole change in 1
  in the other 1, something else also moved, so accepting this shape there would promote a difference nobody reviewed
  5650 pixel(s): card/summary, card/compact
  variance accept --shape v1:203640236f6a486afeca1e45f656e4dd
```

## Ask the rest only when the condition holds

- **`adjudicate --claims <path>` — if you made the edit, and before you read the
  diff.** Declare what you meant to change; the claims file format is below.
  Its answer *declared, and did not happen* is how you learn an edit never
  landed, which no comparison of images can tell you. Claims copied out of
  `changes` score the run against itself and are worthless. As
  `variance ask adjudicate` it exits `0` like every question. As
  `variance adjudicate` it exits `1` unless every claim is delivered and no
  changed subject is left unclaimed or ungrouped; `--exit-zero-on-changes`
  turns that `1` into `0` and prints that on stderr.
- **`composition` — before calling anything flaky**, and when a change has no
  obvious author. It names what explains a movement, and separates `flake`
  (read twice, differed) from `suspect` (never read twice).
- **`locate --query <words>` — when you can describe the subject but do not have
  its id.** See [locate](locate.md). `composition --subject <id>` then lists
  what that subject is made of.
- **`describe`, `explain-verdict`, `trace-component`, `findings` — once you know
  which subject or component matters.** Ask them one at a time. Ask
  `explain-verdict` when a subject was not compared at all: it separates
  `incomparable` (a baseline exists, another machine or an older recipe of this
  tool rendered it) from `new` (no baseline) from never observed.
  `findings --rule <id>` keeps one rule.
- **`variations` — when a subject has arms**: a flag's other arm, a second
  viewport, a dark scheme, measured against its parent subject rather than a
  baseline. It names the bands and components the variation changes, and is
  never a verdict.
- **`costs` — before narrowing a run or splitting a file of stories.** The
  slowest files and subjects, from the mainline's shared times unless you name a
  report; `--from <path>` keeps subjects declared under it.
- **`changelog --shape <digest>` or `--subjects <id>,…` — before proposing an
  accept, and never after.** It previews what accepting that selection would
  write down, and which subjects it would refuse.
- **`decisions --subject <id>` or `--build <id>` — before proposing an accept
  of something a reviewer already looked at.** Every approval and rejection the
  review deployment recorded, newest first, with who made it and their note; the
  first row for a subject and build is the one that stands. It reads with the
  share token, which never decides, so nothing you ask here approves or rejects
  anything. A 403 naming the ingest token means `VARIANCE_SHARE_TOKEN` holds
  CI's token, not the share token.
- **`concerns --build <id>` or `--subject <id>` — before changing a render a
  reviewer flagged, or proposing its baseline.** What reviewers suspect without
  having decided: each concern's title, its state (`open`, `investigating`,
  `resolved`), the region and component it is about, what the reviewer pointed
  at, and every step since with its note and hypothesis. `--build` reads the
  concerns on every subject that build showed, whichever build raised them, and
  counts them by state; `--state open` keeps the ones nobody has picked up. It
  reads the same deployment with the same share token as `decisions`, so nothing
  you ask here raises, moves or resolves a concern.

## `ask diff` has two subjects

A watcher address decides which: `--at <address>`, or an exported
`VARIANCE_AUTHORITY_VANTAGE` when `--at` is not given. With one, it queries that
watcher for what changed since the last reading it handed out: the progress
question, in [live run](live-run.md). Without one, it compares the report with
the state the previous successful `ask` recorded beside it, in `asked.json` in
the report's directory: the re-run question. The first call of either records
state and has nothing to compare:

```
No previous invocation was recorded. The current state is now remembered.
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
    { "root": "component:Badge", "reason": "new brand accent on the status pill" }
  ]
}
```

An empty array is refused rather than adjudicated, because "0 claims, 0
undelivered" reads as reassurance. A file that does not parse is refused for the
same reason. How to read the answer is in
[check an edit](check-an-edit.md#2-adjudicate).
