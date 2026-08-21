<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/report

**Requires:** nothing for the format. `report/file` requires a path this process
can read and write.

What a run leaves behind. The observation pipeline produces values in memory and
then the process ends; this is the shape those answers take so they can be read
afterwards, from a different process, on a different machine, by whoever or
whatever is asking.

## Why it is its own package

It has several readers. The CLI writes it, a PR comment renders it, the MCP tools
read it, and none of those is the format's home — a format owned by one reader
bends towards that reader.

The failure that shape produces is concrete: with these types living in
`@variance-authority/mcp`, the CLI depends on an agent protocol to describe its
own output.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | `RunReport`, `ObservationRecord`, `RegionRecord`, `NotObserved`, `clusterChanges`, `adjudicateRun` |
| `./file` | a filesystem | `readRunReport`, `writeRunReport` |

The split exists because a run happening on a pinned machine in CI and the
questions being asked on a laptop is exactly why this artifact exists — and a
consumer who moves it some other way (an object store, a PR comment, a socket)
wants the shapes and not the disk.

## Usage

```ts
import type { RunReport } from '@variance-authority/report';
import { readRunReport, writeRunReport } from '@variance-authority/report/file';

await writeRunReport('.variance/run.json', runReport);

// Throws on anything that is not one, so the type is earned rather than asserted.
const report: RunReport = await readRunReport('.variance/run.json');
```

## The three derivations that belong to the format

None has a home in a reader. `clusterChanges` groups a run's changed subjects
by fingerprint, so a token edit across forty stories is **one decision presented
once** rather than forty. `adjudicateRun` reads those changes back against what
the author said they were doing:

```ts
import { adjudicateRun, describeAdjudication } from '@variance-authority/report';

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

## Why a baseline is what it is

A baseline update lands in a run of its own — `variance accept` promotes what a
reviewer looked at — and the artifact that lands says *what* the new baseline is
and nothing about **what the change was**. A month later, at the twelfth 2px
approval, the report that could have said is gone with the CI job.

`changelogOf` folds a report and the subjects that were actually accepted into
one record, and `renderCommitMessage` puts it where the baseline is: in the
commit message, as prose a reviewer reads and trailers a parser reads.

```ts
import {
  changelogOf,
  isRecorded,
  renderCommitMessage,
  parseCommitMessage,
} from '@variance-authority/report';

const record = changelogOf({
  report,
  accepted: ['story:card--small', 'story:card--large'],
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
| `accepted` | the subjects actually promoted. The entries are the **intersection** with each cluster, never the cluster's own list — `accept --shape` refuses by name any subject where something else also moved, and an entry that copied the cluster would claim those too |
| `selection` | `named`, `shape` or `all`. Recorded rather than inferred: a regeneration under `--all` and a reviewed subject are different amounts of review, and a record that flattened them would let one read as the other |
| `at` | ISO 8601, injected. Nothing written into a record may come from a hidden clock |
| `project` | optional; the name the run is scoped by |
| `by` | optional; who accepted |
| `entries` | optional; entries a caller already formed, appended after the clustered ones. Region clustering is one producer of entries, not the definition of one — a change to an interface is the same kind of fact and has no rectangle, and the alternative was fabricating four numbers into a `RegionRecord` to get through the region path. `ungrouped` is untouched by them, and an entry with no fingerprint, no subjects, or fewer reached than promoted is refused rather than written |

It refuses — with a sentence, not an empty record — when nothing was accepted,
and when the report cannot name its run. An invented run id would attribute a
baseline to a build that never happened.

A record is written once and read for as long as the baseline lives, so three
things are kept out of it deliberately: **no changed-pixel count**, which
measures displacement rather than magnitude and moves with the machine that took
it — the regions say where the change was instead; **no rendered prose**, so
drift is a token and two values rather than a sentence a later release could
never reword; and **nothing derivable**, so there is no accepted-subject total
that could disagree with the entries. `changelogVersion` moves only when an
existing field changes meaning — a reader keeps keys it does not recognise and
writes them back, so adding one does not need a version.

`renderCommitMessage` takes `message`, the operator's subject line, which is
emitted unchanged, and `record`. The trailers are versioned and opaque, one per
change, scanned out of the **whole** message rather than the last paragraph — a
squash merge stops them being the last paragraph, and a reader that only looked
there would silently return nothing.

Reading it back where baselines are commits is
[`@variance-authority/store`](../store)'s `readChangelog`; where they are rows it
is [`@variance-authority/tribunal`](../tribunal)'s.

## What it refuses

`readRunReport` checks `runVersion` and validates `notObserved` rather than
casting. Both refusals earn their cost:

- These tools answer questions an agent then **edits code on**. A silently
  misparsed report produces confident answers about fields that were never there.
- `notObserved` is the field a summary claims a clean run *from*. A malformed
  entry that survived parsing would be counted as neither a failure nor an
  exclusion, and would quietly stop holding the run open.

The price is that a report from a future writer with a third `kind` is refused
outright rather than partly understood. That is the intended trade: partly
understanding a coverage list is precisely the failure this field exists to
prevent.
