# @variance-authority/report

**Requires: nothing** for the format. `report/file` requires a filesystem.

What a run leaves behind. The observation pipeline produces values in memory and
then the process ends; this is the shape those answers take so they can be read
afterwards, from a different process, on a different machine, by whoever or
whatever is asking.

## Why it is its own package

It has several readers. The CLI writes it, a PR comment renders it, the MCP tools
read it, and none of those is the format's home — a format owned by one reader
bends towards that reader.

That was not hypothetical. These shapes used to live in
`@variance-authority/mcp`, so the CLI depended on an agent protocol to describe
its own output.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | `RunReport`, `ObservationRecord`, `RegionRecord`, `NotObserved` |
| `./file` | a filesystem | `readRunReport`, `writeRunReport` |

The split exists because a run happening on a pinned machine in CI and the
questions being asked on a laptop is exactly why this artifact exists — and a
consumer who moves it some other way (an object store, a PR comment, a socket)
wants the shapes and not the disk.

## Usage

```ts
import type { RunReport } from '@variance-authority/report';
import { readRunReport, writeRunReport } from '@variance-authority/report/file';

await writeRunReport('.variance/run.json', report);
const report = await readRunReport('.variance/run.json');  // throws on anything that is not one
```

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
