# Make one test cost less

Selection decides which tests run after an edit. It does not change what one of
them costs while it runs, and it does not change how often the next edit reaches
it. Both of those are properties of the boundary the test loads.

A test that imports a module runs that module's top level whether or not it ever
calls into it. You pay for the load on every run, and the file graph selects
the test whenever that module changes — so an import nothing exercises is a
cost in both halves of this chapter at once.

## What to read before you change a boundary

| Question | Reading | Route |
| --- | --- | --- |
| What did this test address, and what source did it enter? | One test's [Eyes](eyes.md) journal joined to its [execution index](execution-record.md) | [Distil a test](distill.md) |
| Which modules did it load without entering? | The same reading, region by region | [Imports nothing ever calls](distill.md#imports-nothing-ever-calls) |
| Which regions has nothing in the pool ever entered? | The journal accumulated across runs | [What a record knows](selecting.md#what-a-record-knows-that-no-graph-can) |
| Does a mock already written still take? | Taints held against the record | [Where they disagree](selecting.md#where-the-taints-and-the-record-disagree) |

The first two are about one test. The last two are about the suite, and they are
where a boundary worth changing usually shows up first.

## An import is not a use

`import { HeavyChart } from './heavy-chart'` reads as a use to the graph and to
a reviewer, and the test may never render it:

```tsx
return points.length === 0 ? <EmptyState /> : <HeavyChart points={points} />;
```

A spy arrives at the same place from the other side. `vi.spyOn(totals,
'formatTotal')` leaves the module loaded and answers in its function's place, so
nothing below the top level runs.

Both leave one trace, and `variance distill` reports it: the module root
crossed, every declaration below it uncrossed. The reading names the module, the
declarations nothing reached, and the substitution to try.

```text
Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

## A written mock narrows the next selection too

Replace the import and two things happen. The run stops evaluating the module,
which is the saving you asked for. And the source scan stops drawing the edge:
it reads `vi.mock`, `jest.mock` and `sb.mock` off test, story and setup files,
and takes the mocked module out of the graph as seen from that file at every
level. This test stops being selected by a change to the module it replaced, or
to anything only that module reaches.

That is why an explicit mock beats a spy that happens to intercept everything. A
spy is a fact about one run; a `vi.mock` call is a fact the scan can read
without running anything, so it reaches the decision made before the suite
starts. The [expensive row](selecting.md#the-expensive-row-and-what-retires-it)
is retired by the same reader.

A mock that stops taking then becomes a selection hole rather than a slow test,
which is what `auditTaints` watches: a module a test shadows and the record says
it entered is a mock that did not take, or a taint that is wrong about it.

## Verify the substitution, do not assume it

Mocking removes the top level with the rest, and a top level that registers a
handler, installs a polyfill or builds a singleton is one the test may depend
on. Nothing in the reading knows which.

So change one boundary, rerun the exact test, and compare the witness. If an
assertion loses its causal path, an addressed target disappears, or an update
initiator outside the addressed paths reaches the retained surface, revert the
substitution or state the behavior the test actually owns.
[The agent loop](distill.md#the-agent-loop) is that comparison written down for
an actor that runs it for you.

## What this does not reach

**A module with no probes.** An uninstrumented module was entered by nobody the
record can see, and that is silence rather than absence. Only an instrumented
module testifies here.

**A recording that stopped early.** An observation the journal recorded as
truncated proves no absence, so it is dropped from the pool rather than counted
as having missed anything.

**A suite-wide ranking.** `variance distill` reads one test at a time. The
ordered work list it produces is for that test; nothing here ranks which test in
a suite is worth opening first.

---

**Further:** [`distill.md`](distill.md) for the three readings and the CLI, MCP
and skill entrances · [`selecting.md`](selecting.md) for the scan, the taints
and what a record knows · [`packages/distill`](../packages/distill) for the
callable analyzer · [`packages/sense`](../packages/sense/README.md#correct-what-a-files-text-claims-to-import)
for the taint tables themselves.
