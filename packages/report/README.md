<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/report

> The shape a Variance Authority run leaves behind, so a person, a pull request and an agent read one format.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

A run compares a list of **subjects** — a subject is one named UI state you
asked for and can ask for again, such as a component story or a route at a fixed
viewport — and produces its answers in memory. Then the process ends. The file
this package describes is how those answers survive it: written by the run on a
pinned CI machine, read back on your laptop, in a pull request comment, or by an
agent asked to fix what moved.

That file is a `RunReport`. This package gives you its TypeScript types, a reader
that validates rather than casts, and three derivations that turn a list of
changed screenshots into something you can act on:

- **`clusterChanges`** groups the run's changes by the shape that caused them, so
  a token edit landing in forty stories is one decision instead of forty.
- **`adjudicateRun`** checks the run against what you said you were changing, and
  reports the edit that silently did not take.
- **`changelogOf`** folds what a reviewer accepted into a record of *why* a
  baseline is what it is, ready to go into the commit message that lands it.

This package compares nothing itself. It has no browser, no renderer and no
baseline store. Something else produces a `RunReport` — the `variance` CLI does,
and so can your own runner — and this reads it.

## Requirements

- Node 22 or newer.
- ESM only. This package is `"type": "module"` and ships no CommonJS build.
- No peer dependencies, and no browser. The root entrypoint is plain data
  handling; only `@variance-authority/report/file` touches a disk.

## Install

```bash
npm install --save-dev @variance-authority/report @variance-authority/cli
```

The CLI is here because it is what writes the report the examples below read.
It is a devDependency, so every command on this page is run as
`npx variance <command>`.

## Turn a run into a review plan

`npx variance run` writes its report to `.variance/report.json` unless your
`variance.config.json` names another path. This reads that file and prints what
one reviewer actually has to decide:

```ts
// review-plan.ts — node --experimental-strip-types review-plan.ts
import { clusterChanges, describeClustering } from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';

const report = await readRunReport('.variance/report.json');
const changed = report.observations.filter(
  (observation) => observation.verdict === 'changed',
).length;
const clustering = clusterChanges(report.observations);

console.log(describeClustering(clustering, changed));

for (const change of clustering.changes) {
  const where = change.component ?? change.fingerprint;
  console.log(
    `${where}: ${change.subjects.length} subject(s) touched, ` +
      `${change.settles.length} settled by one decision`,
  );
  // `settles` is the set where this shape is the *whole* difference, so one
  // approval promotes nothing unreviewed alongside it.
  if (change.settles.length > 0) {
    console.log(`  npx variance accept --shape ${change.fingerprint}`);
  }
}

for (const subject of clustering.ungrouped) {
  console.log(`${subject}: changed with no shape to group it by`);
}
```

Each **change** in `clustering.changes` is one fingerprint — a digest of the
shape of the difference, stamped on every region of the diff and built from the
component responsible, so the same-looking change in `Avatar` and in `Badge`
stays two changes. `ungrouped` lists subjects that changed and produced no
fingerprint at all; they are never folded into a catch-all.

### What you get

For a run where a brand accent changed `Button` in two stories and on the
checkout route, and spacing moved `Card` on that same route:

```
3 subject(s) changed, and they are 2 distinct change(s) — 1 of which can be decided in one action
Button: 3 subject(s) touched, 2 settled by one decision
  npx variance accept --shape v1:9f2c41ab8d0e5573
Card: 1 subject(s) touched, 0 settled by one decision
```

`npx variance accept` promotes the images that run already produced; it never
re-renders. It takes subject ids, `--all`, or `--shape <fingerprint>` as printed
above, and it refuses by name any subject where something the shape does not
account for also moved — which is why the checkout route is in `subjects` and
not in `settles`.

## The shape

A `RunReport` is one JSON value: run metadata plus one `ObservationRecord` per
subject. Abridged to the fields most reports use:

```json
{
  "runVersion": 1,
  "at": "2026-08-27T10:00:00.000Z",
  "identity": {
    "renderer": "playwright-chromium@1.49.0",
    "engine": "chromium@131",
    "platform": "linux-x64",
    "deviceScaleFactor": 1,
    "fonts": ["Inter"]
  },
  "retention": "durable",
  "run": { "id": "ci-4821", "commit": "a1b2c3d" },
  "observations": [
    {
      "subject": "component:Button/primary",
      "verdict": "changed",
      "because": "180 pixels differ inside the label",
      "changedPixels": 180,
      "regions": [
        {
          "x": 4,
          "y": 8,
          "width": 60,
          "height": 18,
          "pixels": 180,
          "component": "Button",
          "file": "src/ui/Button.tsx",
          "fingerprint": "v1:9f2c41ab8d0e5573",
          "cause": true
        }
      ]
    }
  ],
  "notObserved": [
    { "subject": "route:/settings", "kind": "failed", "because": "navigation timed out" }
  ]
}
```

`identity` is the machine and renderer the pixels came from — what a baseline is
only comparable within. Each observation's `verdict` is the run's answer for that
one subject: `unchanged`, `changed`, `new`, `incomparable` or `ignored`. Its
`regions` are the rectangles of the diff, each naming the component and pixel
count that explain it.

`notObserved` lists subjects the run planned and has no answer for, each
`excluded`, `failed` or `unreached`. **Absent is not empty**: a report written by
something other than `variance run` may never say what it skipped, and that is a
different claim from "it skipped nothing". Read it before you print "nothing to
review" — a run that planned 300 subjects, failed on 50 and found 250 unchanged
has an all-clean observation list.

Three further fields are present only when the run had something to put in them:

- `narrowing` — the ref the run was told to observe from (`--since`), and where
  the recorded execution index stands: the commit it was written at, and how many
  files the working tree differs from it by. A run that observed everything
  includes the second half alone, which is what makes the option visible to a
  reader who never passed one. Absent `index` means there is nothing to diff
  from; it never means the index is current, which is `changed: 0`.
- `drift` — design tokens whose value changed in this run, each with what it
  changed from, what it changed to, and how many approved steps it took to get
  there. This is what a single comparison structurally cannot show: eleven
  correct 2px approvals sum to a 22px move nobody reviewed.
- `journeys` — for a build instrumented with `testSelectionProbes()` from
  `@variance-authority/sense`, the modules where the run's subjects entered
  different regions of the source, plus the pool of subjects that answer is drawn
  from. Absent means no execution journal was written — most builds have no
  probes — and never that every subject took the same path through the source.
  The terms are in [journeys](https://variance-authority.dev/docs/journeys).

### Signals beside the verdict

An `ObservationRecord` can come with `signals`: independently measured
boundaries — `document`, `pixels`, `accessibility` and `presentation`. A missing
member means that boundary was never measured, not that it was clean.

`signals.presentation` retains what changed in the rendered relationships between
elements, beside the document, pixel and accessibility boundaries. It does not
change the verdict. A comparable presentation signal has the two digests,
information counts, and `introduced`, `resolved` or `persisted` effects; an
empty `effects` list means both sides were measured and no relationship changed.
An `incomparable` one gives a reason and no effects.

The CLI passes the signal through both the pixel-compared path and the path
where a subject's document digest matched the baseline's, so it was declared
unchanged without being repainted at all. The JSON file, HTML report, text
report, MCP description and Tribunal record all read that stored value rather
than re-running the analysis. The producing API is in
`@variance-authority/presentation`.

## Entrypoints

| entrypoint | requires | exports |
|---|---|---|
| `.` | nothing | `RunReport`, `ObservationRecord`, `PresentationSignalRecord`, `RegionRecord`, `NotObserved`, `clusterChanges`, `adjudicateRun`, `changelogOf` |
| `./file` | a filesystem | `readRunReport`, `writeRunReport`, `readSuiteIndex`, `writeSuiteIndex` |
| `./suite-index` | nothing | `suiteIndexOf`, `encodeSuiteIndex`, `decodeSuiteIndex`, `SuiteIndex` |

Import `./file` only when this process should read or write a local path. An
object store, a pull request comment or a socket carries the same `RunReport`
value without it.

`./suite-index` is the part of a report that is not about the run: what the suite
is made of — its subjects, its components, every name each one goes by. That is a
fact about the commit, it changes only when the suite does, and it is asked for
far more often than a run happens. `suiteIndexOf` takes it out of a report as
bytes, addressed by that commit, small enough for a cache to keep and stable
enough that two machines composing the same suite write the same file.
`decodeSuiteIndex` refuses anything else.

## Check a run against what you said you were doing

`adjudicateRun` reads the run's changes back against your declared claims. Each
claim names a root — `component:Button`, `shape:<fingerprint>`, or a bare name
read as a component — matched exactly, with an optional cap on how many subjects
it may reach:

```ts
// adjudicate.ts — node --experimental-strip-types adjudicate.ts
import { adjudicateRun, describeAdjudication } from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';

const report = await readRunReport('.variance/report.json');
const answer = adjudicateRun(
  report,
  [{ root: 'component:Button', reason: 'new brand accent', maxSubjects: 3 }],
  // Claim fields this resolution does not read, named so the answer can say so.
  { unchecked: ['viewport'] },
);

console.log(describeAdjudication(answer));
```

### What you get

On the same run:

```
Every declared edit landed; something you did not declare also moved.
1 claim(s): 1 delivered, 0 undelivered, 0 over-reaching, 0 unchecked. 1 unclaimed change(s).

  [delivered] component:Button
      declared (new brand accent) and delivered: component:Button changed in 3 subject(s): component:Button/primary, component:Button/disabled, route:/checkout. Not checked here: viewport.
      src/ui/Button.tsx

  [unclaimed] Card
      Card moved and no claim covers it — 1 subject(s), 240 pixel(s), nothing it can settle on its own
      src/ui/Card.tsx

  [not observed] 1 subject(s) were not looked at, so every line above is bounded by what this run saw: route:/settings
```

Lower `maxSubjects` to 2 and the same claim comes back `[overreached]` —
"the change is the intended one, its reach is not". A claim comes back
`delivered`, `overreached`, `undelivered` or `unobservable`.

`undelivered` is the one no diff produces on its own: a component that rendered
and held still, which means your edit did not take. Telling that apart from
*never rendered here, so nothing in this run is evidence either way* needs the
report's `composition.components` — which components the run's subjects rendered
at all. With it, the two cases separate into `undelivered` and `unobservable`;
without it, `adjudicateRun` cannot make the distinction and says so rather than
guessing.

`unchecked` is how a caller keeps a claim it could not verify. A boundary that
parses claims from an agent — the MCP tool, the CLI — passes through the field
names this resolution does not read, and the answer ends `Not checked here:
viewport` instead of reporting `delivered` about something nothing looked at.

## Record why a baseline is what it is

A baseline update lands in a run of its own, and the artifact that lands says
*what* the new baseline is and nothing about what the change was. A month later,
at the twelfth 2px approval, the report that could have said so left with the CI
job.

`changelogOf` folds a report and the subjects actually accepted into one record,
and `renderCommitMessage` puts it where the baseline is — in the commit message,
as prose a reviewer reads plus trailers a parser reads:

```ts
// changelog.ts — node --experimental-strip-types changelog.ts
import {
  changelogOf,
  clusterChanges,
  isRecorded,
  parseCommitMessage,
  renderCommitMessage,
} from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';

const report = await readRunReport('.variance/report.json');
// What `npx variance accept --shape <fingerprint>` would have promoted for every
// shape in the run: the subjects each shape settles on its own.
const accepted = clusterChanges(report.observations).changes.flatMap(
  (change) => change.settles,
);

const record = changelogOf({
  report,
  accepted,
  selection: 'shape',
  at: new Date().toISOString(),
  project: 'design-system',
  by: 'marina',
});

if (!isRecorded(record)) throw new Error(record.because);

const text = renderCommitMessage({
  message: 'chore(variance): regenerate baselines',
  record,
});
console.log(text);
// The same record, back out of a commit somebody squash-merged:
console.log(parseCommitMessage(text));
```

### What you get

```
chore(variance): regenerate baselines

v1:9f2c41ab8d0e5573 Button src/ui/Button.tsx 2/3

run ci-4821 @ a1b2c3d --shape marina

Variance-Run: v1 eyJjaGFuZ2Vsb2dWZXJzaW9uIjoxLCJydW4iOiJjaS00ODIxIiwiY29tbWl0Ijoi…
Variance-Change: v1 eyJmaW5nZXJwcmludCI6InYxOjlmMmM0MWFiOGQwZTU1NzMiLCJjb21wb25l…
```

The two trailers are one base64 line each, truncated above. `2/3` in the prose
is the count that makes the record honest: two subjects promoted, out of the
three this shape reached. The `Card` shape settles nothing on its own, so it
contributes no entry. `parseCommitMessage` gives back the full record —
`fingerprint`, `component`, `file`, `subjects`, `reached`, `cause` — and scans
the whole message for trailers rather than only the last paragraph, since a
squash merge moves them out of it.

`renderCommitMessage` takes exactly two things: `message`, the subject line in
your words, and `record`, what `changelogOf` returned. It writes no subject line
of its own, so a commit says what you meant it to say and the trailers say what
was promoted.

`changelogOf` takes:

| option | what it decides |
|---|---|
| `report` | the run the reviewer read. Nothing is re-derived from bytes; the entry is evidence about a decision, not a second opinion about an image |
| `accepted` | the subjects actually promoted. Entries are the intersection with each cluster, never the cluster's own list — `accept --shape` refuses by name any subject where something else also changed, and an entry copying the cluster would claim those too |
| `selection` | `named`, `shape` or `all`. Recorded rather than inferred: a regeneration under `--all` and a reviewed subject are different amounts of review |
| `at` | ISO 8601, injected. Nothing written into a record comes from a hidden clock |
| `project` | optional; the name the run is scoped by |
| `by` | optional; who accepted |
| `entries` | optional; entries you already formed, appended after the clustered ones. A change to an interface is the same kind of fact and has no rectangle. An entry with no fingerprint, no subjects, or fewer reached than promoted is refused rather than written |

It returns an `Unrecordable` with a `because` — never an empty record, which
would read as "nothing changed" — when nothing was accepted, or when the report
names no run id to attribute the baseline to. `isRecorded` narrows between the
two.

The record omits a changed-pixel count (the regions already say where the change
was), rendered prose, and any derived total. `changelogVersion` changes only when
an existing field's meaning changes; a reader keeps keys it does not recognise,
so a new field does not need one.

Reading it back where baselines are commits is `@variance-authority/store`'s
`readChangelog`; where they are rows it is `@variance-authority/tribunal`'s.

## What the reader refuses

`readRunReport` validates rather than casts. It throws on:

- an unknown `runVersion`, including one from a future writer
- a malformed `notObserved` entry
- a presentation transition missing the before/after evidence it requires

You get a fully-typed `RunReport` back, or an error — never a partially-parsed
value with fields silently absent. An absent `notObserved` stays absent rather
than becoming an empty list.

---

**[@variance-authority/report](https://variance-authority.dev/reference/packages/report)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
