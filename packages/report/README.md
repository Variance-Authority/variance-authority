<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/report

> The shape a Variance Authority run leaves behind, so a person, a pull request and an agent read one format.

A run compares one or more **subjects** — the pages,
routes, or components under test — and produces its answers in memory before the
process ends. A **`RunReport`** is the shape those answers take, so they can be
read afterwards: from a different process, on a different machine, by whoever or
whatever is asking. The format itself is plain data; only `report/file` touches a
disk, and it needs a path this process can read and write.

```bash
npm install --save-dev @variance-authority/report
```
## Use this package when

Install `@variance-authority/report` when a producer and its readers need a
versioned run artifact without sharing a runner, browser, or transport. Use the
root entrypoint for in-memory report types and derivations. Use
`@variance-authority/report/file` only when this process should read or write a
local path; an object store, PR comment, or socket should carry the same
`RunReport` value without importing the file entrypoint.

This package does not compare anything itself. It has no browser, no renderer,
and no baseline store — pair it with whatever produces a `RunReport` (the
`variance` CLI, or a custom runner) and, on the reading side, with something
like `@variance-authority/mcp` or `@variance-authority/store`.

## Package boundary

The format has several readers. The CLI writes it, a PR comment renders it, the
MCP tools read it, and none of those is its home — a format owned by one reader
bends towards that reader.

What that would cost is concrete: with these types living in
`@variance-authority/mcp`, the CLI would depend on an agent protocol to describe
its own output.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | `RunReport`, `ObservationRecord`, `PresentationSignalRecord`, `RegionRecord`, `NotObserved`, `clusterChanges`, `adjudicateRun` |
| `./file` | a filesystem | `readRunReport`, `writeRunReport`, `readSuiteIndex`, `writeSuiteIndex` |
| `./suite-index` | nothing | `suiteIndexOf`, `encodeSuiteIndex`, `decodeSuiteIndex`, `SuiteIndex` |

The split exists because a run happening on a pinned machine in CI and the
questions being asked on a laptop is exactly why this artifact exists — and a
consumer who carries it some other way (an object store, a PR comment, a socket)
wants the shapes and not the disk.

`./suite-index` is the part of a report that is not about the run. What the
suite is made of — its subjects, its components, every name each one carries —
is a fact about the commit the run was at, it changes only when the suite does,
and it is asked for far more often than a run happens. So it is taken out of a
report as bytes (`suiteIndexOf`), addressed by that commit, small enough for a
cache to carry and stable enough that two machines composing the same suite
write the same file. `decodeSuiteIndex` refuses anything else.

## Smallest working path

```ts
import { readRunReport, writeRunReport } from '@variance-authority/report/file';

// Throws on an unknown runVersion or malformed notObserved entry.
const report = await readRunReport('.variance/run.json');
console.log(report.runVersion, report.observations.length);

// A producer can write the same validated shape to a new path.
await writeRunReport('.variance/checked.json', report);
```

The read returns a validated `RunReport`; the file entrypoint does not rerun a
browser or recompute observations. A report from a future format is refused,
and an absent `notObserved` field remains absent rather than being treated as an
empty coverage list.

## The shape

A `RunReport` is one JSON value: run metadata plus one **`ObservationRecord`**
per subject. Trimmed to the fields most reports use:

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
  "observations": [
    {
      "subject": "component:Button",
      "verdict": "changed",
      "because": "12 pixels differ inside the label",
      "changedPixels": 12,
      "regions": [
        { "x": 4, "y": 8, "width": 60, "height": 18, "pixels": 12, "component": "Button", "cause": true }
      ]
    }
  ]
}
```

Each `ObservationRecord` holds one subject's **verdict** — `unchanged`,
`changed`, `new`, `incomparable`, or `ignored` — and, when it changed, the
**region**s responsible: attributed rectangles of the diff, each with the
component and pixel count that explain it.

A report also carries **`narrowing`**: the ref a run was told to observe from,
and where the recorded execution index stands — the commit it was written at,
and how many files the working tree differs from it by. A run that observed
everything carries the second half alone, which is what makes a narrowing option
visible to a reader who never passed one. Absent `index` means there is nothing
to diff from, either because no index was recorded or because the one on disk has
no position; it never means the index is current, which is `changed: 0`.

A build instrumented with `testSelectionProbes()` writes a journal — which
regions of source each subject entered while it was painted — and its report
carries **`journeys`**: the modules where the run's subjects entered different
regions, and the pool that finding is drawn from, as three lists of subjects:
the ones with a complete journal, the ones whose journal was cut short, and the
ones the journal has no row for. Absent is *no journal*, never *nobody parted*;
`found` empty is the pool agreeing everywhere. The terms are in
[journeys](../../docs/journeys.md).

## Presentation consequence is a signal, not a verdict

An `ObservationRecord` can carry one or more **signals** —
`ObservationRecord.signals`, each an independently measured boundary
(`document`, `pixels`, `accessibility`, `presentation`); a missing member means
that boundary was never measured, not that it was clean.
`ObservationRecord.signals.presentation` retains what changed in rendered
relationships beside the document, pixel, and accessibility boundaries. It is
orthogonal to the renderer's layout, paint and composite impact, and does not
change the observation verdict.

A comparable signal carries the two presentation-report digests, information
counts, and `introduced`, `resolved`, or `persisted` relationship effects. An
empty `effects` list means both sides were measured and no relationship
consequence changed. An `incomparable` signal carries a reason and no effects;
an absent `presentation` member means nothing measured that boundary.

Product-aware collectors return the signal with their collected subject. The
CLI carries it through both a pixel-compared path and a **digest-settled**
one — a subject whose document digest matched the baseline's, so it was
declared unchanged without ever being repainted — and the JSON file, HTML
report, text report, MCP description, and Tribunal record read the same stored
value without re-running presentation analysis. The producing API and a complete
example live with `@variance-authority/presentation`.

## Format derivations

None of these has a home in a reader. `clusterChanges` groups a run's changed subjects
by fingerprint — the shape digest carried on each region — into a **cluster**:
the set of subjects a single accept-or-reject decision covers. A token edit
across forty stories becomes one cluster, so it is **one decision presented
once** rather than forty. `adjudicateRun` reads those changes back against what
the author said they were doing:

```ts
import { readRunReport } from '@variance-authority/report/file';
import { adjudicateRun, describeAdjudication } from '@variance-authority/report';

const report = await readRunReport('.variance/run.json');
const answer = adjudicateRun(
  report,
  [{ root: 'component:Button', reason: 'new brand accent', maxSubjects: 3 }],
  { unchecked: ['bands'] },
);

console.log(describeAdjudication(answer));
```

Each claim comes back `delivered`, `overreached`, `undelivered` or
`unobservable`, alongside the changes no claim covered. `undelivered` is the one
no diff can produce on its own — a component that **rendered and held still**,
which means the edit did not take. Telling that apart from *never rendered, so
nothing here is evidence* is what the composition census is for, and why the
adjudication lives beside the format rather than inside a reader.

`unchecked` is how a boundary keeps a claim it could not verify. A caller that
parses agent-supplied claims — the MCP tool, the CLI — passes the field names
this resolution does not read, and the answer ends `Not checked here: bands`
instead of reporting `delivered` about something nothing looked at. Dropping
them silently would be the more comfortable default and the worse one: the agent
would be told its band claim held.

## Changelog derivation

A baseline update lands in a run of its own — `variance accept` promotes what a
reviewer looked at — and the artifact that lands says *what* the new baseline is
and nothing about **what the change was**. A month later, at the twelfth 2px
approval, the report that could have said so is gone with the CI job.

`changelogOf` folds a report and the subjects that were actually accepted into
one record, and `renderCommitMessage` puts it where the baseline is: in the
commit message, as prose a reviewer reads and trailers a parser reads.

```ts
import { readRunReport } from '@variance-authority/report/file';
import {
  changelogOf,
  isRecorded,
  renderCommitMessage,
  parseCommitMessage,
} from '@variance-authority/report';

const report = await readRunReport('.variance/run.json');
const accepted = report.observations
  .filter((observation) => observation.verdict === 'changed')
  .slice(0, 2)
  .map((observation) => observation.subject);
if (accepted.length === 0) throw new Error('the report has no changed subject to promote');

const record = changelogOf({
  report,
  accepted,
  selection: 'shape',
  at: new Date().toISOString(),
  project: 'design-system',
  by: 'marina',
});

if (isRecorded(record)) {
  const text = renderCommitMessage({ message: 'chore(variance): regenerate baselines', record });
  parseCommitMessage(text); // the same record, out of a commit somebody squash-merged
}
```

`changelogOf` takes:

| option | what it decides |
|---|---|
| `report` | the run the reviewer read. Nothing is re-derived from bytes; the entry is evidence about a decision rather than a second opinion about an image |
| `accepted` | the subjects actually promoted. The entries are the **intersection** with each cluster, never the cluster's own list — `accept --shape` refuses by name any subject where something else also changed, and an entry that copied the cluster would claim those too |
| `selection` | `named`, `shape` or `all`. Recorded rather than inferred: a regeneration under `--all` and a reviewed subject are different amounts of review, and a record that flattened them would let one read as the other |
| `at` | ISO 8601, injected. Nothing written into a record may come from a hidden clock |
| `project` | optional; the name the run is scoped by |
| `by` | optional; who accepted |
| `entries` | optional; entries a caller already formed, appended after the clustered ones. Region clustering is one producer of entries, not the definition of one — a change to an interface is the same kind of fact and has no rectangle, and the alternative was fabricating four numbers into a `RegionRecord` to get through the region path. `ungrouped` is untouched by them, and an entry with no fingerprint, no subjects, or fewer reached than promoted is refused rather than written |

It refuses, with a message rather than an empty record, when nothing was
accepted or when the report has no run id to attribute the baseline to.

The record omits a changed-pixel count (the regions already say where the
change was), rendered prose (drift is a token and two values instead), and any
derived total. `changelogVersion` changes only when an existing field's meaning
changes — a reader keeps keys it does not recognize, so adding a new field does
not need one.

`renderCommitMessage` takes `message` (the operator's subject line, emitted
unchanged) and `record`, and emits one versioned, opaque trailer per change.
`parseCommitMessage` scans the whole message for them rather than just the last
paragraph, since a squash merge can move them out of it.

Reading it back where baselines are commits is
`@variance-authority/store`'s `readChangelog`; where they are rows it
is `@variance-authority/tribunal`'s.

## Validation boundaries

`readRunReport` validates rather than casts. It refuses:

- an unknown `runVersion`, including one from a future writer
- a malformed `notObserved` entry
- a presentation transition missing the before/after evidence it requires

A caller gets a fully-typed `RunReport` back, or a thrown error — never a
partially-parsed value with some fields silently absent.
