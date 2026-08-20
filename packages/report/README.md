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

## The two derivations that belong to the format

Neither has a home in a reader. `clusterChanges` groups a run's changed subjects
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
