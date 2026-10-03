# Refine the task

Phase 1 of [`AGENTS.md`](../../AGENTS.md). Before any code, settle what the task
is and what would make it done.

## Look around

**The ask.** Restate it as one sentence that somebody else could check: what is
true when the task is done, and which gate says so — a test, a check, a
measurement, a CI comment. If you cannot write that sentence, the task is not
refined yet.

**Backlog.** A request that processes a Backlog task is governed by the Backlog
section of `AGENTS.md`, starting with
`./node_modules/.bin/backlog instructions overview`. An ad hoc change is not a
Backlog task and does not invoke it.

**The chart.** For non-local work — crossing a boundary, changing a rule or an
invariant, adding a party, asking whether something belongs here, or building
any capability — search the architecture chart first (below). For a one-file
fix, a rename, or a bug with a stack trace pointing at the line, read the code.

**The paper trail.** Search what the project already decided and tried on the
subject before proposing anything:

| Place | What it holds |
|---|---|
| `docs/specs/` | What is not built. One vacancy per file. |
| `docs/context/adr/` | One decision, its alternatives, and its cost. |
| `docs/context/journal/` | What one attempt cost and what it taught. |
| `docs/context/checkpoint.md` | Current state of the whole. |
| [`docs/context/prior-art.md`](../../docs/context/prior-art.md) | Who else measured this, and what they found. |

A proposal that contradicts an ADR or repeats a journal's failed attempt is not
a proposal yet. Name the ADR and argue with it, or pick another route.

**The field.** Ask what this is called elsewhere, who measured it, and how it
failed for them. A metric the project coins needs its observation class —
observed, co-occurrence or inferred — and a base rate before anyone reads it as
evidence.

**What already does this?** Before the task is a plan, it is a question about
the code that exists: which command, function or rule already answers it, or
answers most of it, and how the feature is reached from there — a call, an
extension, a route from one caller to another. Search for the behaviour, not
only the name: `yarn variance ask search --query <words>`, then the commands
`yarn variance --help` lists, then the ADRs that name the subject. When the task
names a mechanism — a journey, a divergence, sense — the project usually
implements it already, and the industry's term for something similar answers a
different question. New code is the exception, and the pull request proves it is
the only way: it names what exists, and says why none of it could carry the
change.

A second implementation of a shipped behaviour is a defect that drifts:
`summarizeObservation` was exported, documented, called by nothing, and
drifting from the private copy `playwright-test` had grown for the same job.
The fallback to relations for a suite with no record was started as a new import
walk in `sense`, with its own tests, before anyone noticed that test selection
already selects by relations — the graph `affectedBy` in `core/relate` walks. What that
feature needed was a route from the record that could not answer to the
selection that already could, and the new walk was a second copy of it.

## Decide, or ask

A rule that reads like accidental cruft against the goal — widening on absence,
refusing on a guess, duplicating an owner's answer — is fixed and reported, not
asked about. A finding the task neither needs nor wrote is fixed in its own
change, on its own branch, as [change](change.md) draws the line. Ask only when
two readings are both defensible and the choice changes what the product
promises.

A limitation is a bug or a position, never an apology. Classify it before
writing "we cannot".

## The architecture chart

The Compass chart root is `.compass/`. It charts the logical system, not the
repository: its blocks are cut by the question each one answers and deliberately
do not line up with `packages/`. The `compass` skill, installed at
`~/.agents/skills/compass`, owns how the chart is read and how it changes.

```bash
python3 ~/.agents/skills/compass/scripts/compass_search.py --chart-root .compass "<task terms>"
```

It prints the matched sections with their heading, file and line range, and says
which of your terms the chart names:

```
Found 10 section(s): 1 direct, 9 BM25-related. BM25 is a lexical ranking signal, not confidence or semantic proof.
Named by a chart heading, slug, or identifier: flake. Named nowhere in the chart: detection.
[1] variance-authority/GLOSSARY.md:562-572
    kind=glossary signal=exact term='flake' bm25=8.1512
    heading=Glossary — variance-authority > Flake
```

Consult the matched owning sections, then follow the skill's Consume route
through every chart level present. BM25-related results are leads, not semantic
proof.

The skill's two routes are exclusive. **Consume** reads an existing chart and
applies it to work done elsewhere. **Create** establishes or changes chart-owned
state — a chart file, a coordinate, a boundary, and this section. Consume never authorizes a chart
edit, and a Consume task that finds the chart missing, stale or disputed records
the finding and stops there.

Without the skill installed, the chart is still readable and the work is
Consume-only: [`.compass/COMPASS.md`](../../.compass/COMPASS.md) is the registry,
[`.compass/README.md`](../../.compass/README.md) states the scope, and every
architectural directory's own `README.md` is its identity document. Replace the
search with `grep -ril "<task terms>" .compass`.
