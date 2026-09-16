# Architecture

[**Variance Authority**](README.md) renders the **subjects** you point it at — a
story, a route, a fixture, or a value such as a JSON body or a schema — compares
each capture against its own stored baseline, and records what changed and why.
It ships as a set of tools with explicit contracts rather than one pipeline you
must run end to end: a team can use a single tool inside an existing workflow, or
compose several into a pipeline that fits its own environment.

The tool is the unit of design: a named capability that can be understood,
replaced, and composed without learning the implementation of every other
part. This keeps lifecycle, rendering, storage, and review choices with the
systems and people that already own them.

## Kinds of tool

| Kind | Takes | Gives | Needs |
|---|---|---|---|
| **acquire** | a live tree | capture material — a document or an in-place raster | a DOM or browser |
| **prepare** | a subject | a subject that holds still | varies; each declares its own |
| **render** | a document | pixels | a browser, here or elsewhere |
| **hash** | anything | an identity | nothing |
| **compare** | two of a kind | a difference | nothing |
| **isolate** | a difference | places | nothing |
| **map** | places | components, then files | a snapshot |
| **judge** | everything above | a verdict | a policy |
| **record** | a verdict | an artifact, or a row that outlives the run | a store |

Two of these need a host — a DOM to acquire from, a browser to render in. Three
need nothing at all. That distribution is the whole economic argument, and it
only exists because the kinds are separate.

**prepare** is itself a set rather than a stage: resets, holds, waits and
supports are individual tricks, each declaring the cheapest tier that can observe
its effect and the property it governs. A recipe is a list of them. Two tricks
over one property is a conflict to report, not a precedence rule to invent.

Every kind here is asked about a subject that already exists. Which subjects are
worth asking about is settled before any of them runs, out of the components a
stored baseline recorded and the files a change reaches in source
([selecting.md](selecting.md)).

## What flows between them

Values, never handles. Every tool takes and returns something serializable. A
`CaptureArtifact` carries either a `RenderDocument` or a `Raster` plus the
semantic and source evidence acquisition could retain. A document is portable
across environments only when it closes over its resource bytes; otherwise the
renderer must have equivalent access to its references. The raster has already
materialized in the host browser and joins at observation.

```
document → identity → raster → difference → places → components → verdict
```

The last three hops of that line are one chain and it is written out in
[`attribution.md`](attribution.md); the graph the first question is asked of is
in [`source.md`](source.md). [`information.md`](information.md) defines how the
visual, semantic, source, runtime, presentation, scenario, review, and history
domains exchange records, align identities, retain evidence, and combine full or
partial runs.

## The contracts

Five rules. A tool that breaks one is broken, whatever it produces.

**1. Declare what you need.** A tool states the cheapest tier that can answer its
question. A tier is then never charged for another tier's requirements — an
unloaded font cannot change which rules match, so the cheap tier waits for
nothing.

**2. Declare what you did.** Anything that could change the answer becomes part
of the identity of the result. The machine, the scale, the fonts, the tricks
applied. Two results whose identities differ are *incomparable*, never
*different* — because a difference in conditions reported as a difference in the
product is a confident wrong answer, and confidence is what makes it expensive.

**3. Absent is not empty.** Not measured, measured as zero, and unobservable are
three states. Collapsing any two produces a pass that nobody earned. This is the
single failure the system exists to refuse, and it reappears at every layer in a
new costume.

**4. Never retry to make a problem go away.** Re-observing until one attempt
happens to agree hides the finding. Repeated reads may classify stability, but
all scheduled reads count and any disagreement refuses the candidate. Detect on
the cheapest capable tier and name the component and file.

**5. Order is the caller's.** Tools compose in whatever order their types allow.
The shipped compositions are supported offerings, not one mandatory pipeline.

## Compositions

Assembled from the same tools, and none is privileged.

**Cheap gate.** acquire → hash → compare against a stored identity. Answers
"anything to do?" with no browser at all. A suite where two subjects changed pays
for two.

**Full observation.** acquire → prepare → render → compare → isolate → map →
judge. What a change costs when the cheap gate cannot settle it.

**Stability check.** acquire twice → compare → map. No render. Catches a subject
that will not hold still, and names why, before any image exists.

**Extension.** A team with Playwright tests chooses an in-place raster or a
deferred document without replacing its runner. A browserless unit suite writes
a document archive for a later browser process. A team with images from elsewhere
takes only the reading end. The pieces below the chosen material never learn
which of the three it was.

## Packages

**The primary cut between packages is what a consumer must supply, not what the
code does.**

A box is named for what it is for — a requirement the manifest cannot state, what
the thing is, or a target, format or protocol it serves, never a library it
imports.
Code that needs one requirement may not sit with code that needs another.
Storybook support does not belong with Playwright helpers — not because they are
different features, but because a Storybook user would then install a browser and
a Playwright user would install a Storybook adapter, and neither asked for the
other. What something *does* is the second cut, made inside a box with
entrypoints.

| package | requires | holds |
|---|---|---|
| `core` | nothing | the format, the rules, comparison, [attribution](attribution.md), verdicts, plans |
| `raster` | nothing | the pixel tier as data: assembly, contracts, policies, interventions, the gate |
| `report` | nothing | what a run leaves behind, so several readers can share one shape |
| `history` | nothing | what a row may contain, what the numbers mean, what to say with no store |
| `ioc` | nothing | the seam a module declares its own state reset through, and the per-test hook a suite drives it with |
| `wire` | nothing; the driver's end of it needs a Node runtime and a loopback socket | one id per execution and one address to answer on, whether the participant is the page, a service in another process, or a server the suite started inside itself |
| `event` | nothing; its `collect` entrypoint additionally needs a Node runtime and a loopback socket | announcements a running system makes about its own decisions, and the log a test waits on |
| `vantage` | nothing; its `attach` entrypoint additionally needs a Node runtime and a loopback socket | what a run is saying while it is still saying it, held in a process that outlives the test |
| `storybook` | a built Storybook's `index.json`, as a value | a project's own stories as a subject list |
| `storybook-collector` | a browser, and a Storybook built or already served | the browser half: each story opened, made ready, and collected |
| `route-collector` | a browser, and an application to reach or a directory to serve | pages an application already serves, opened and collected |
| `sense` | a readable checkout | the source read rather than run: a row per request, per binding and per export, and the probes that mark which regions a run entered |
| `eyes` | a live DOM, with optional RTL or Playwright host APIs | selector and locator attention with React attribution captured before the addressed node moves |
| `distill` | portable [Eyes](eyes.md) attention and/or a [Sense](../packages/sense) [execution index](execution-record.md) | deterministic reduction opportunities for one exact test identity |
| `package` | a readable workspace, built or not | what a package offers an adopter: every entrypoint a manifest opens, and the names behind it, read from manifests and the source they point at |
| `dom` | a live DOM | extraction, and CSS applicability pruning |
| `react` | React internals | fibers → owner chains, props digests, portals |
| `jsx-source` | a JSX transform you control, and a React runtime | the file and line that wrote an element, carried as far as the DOM node |
| `session` | a live DOM | many subjects in one standing world |
| `scenario` | semantic snapshots; its archive entrypoint additionally needs a filesystem | witnessed AAA paths, transition-effect assessment, a partial state machine, and opt-in semantic retention |
| `presentation` | a browser capture; its Playwright entrypoint additionally needs a live browser | one subject's presentation graph, independent ARIA evidence, relationship findings, and removable diagnostic paint |
| `playwright` | a browser | the persistent harness, and a renderer |
| `playwright-test` | a browser, and a Playwright test run | additive observation and assertion helpers; optional unbound fixture and matcher parts |
| `unit-test` | a live DOM, and a writable artifact directory | resource-closed capture archives and a CLI collector for a later render process |
| `png` | a runtime with `Buffer` — Node, not a browser | decoding, comparison, the diff image |
| `png-sharp` | a runtime that can load a native addon, and a platform published for it | the same comparison, with the decoding done natively |
| `store` | a filesystem | baselines on disk, and in git-LFS |
| `remote` | a socket | a renderer and a store on the other side of a hop |
| `server` | a port and a bearer token; `server/sqlite` is the entrypoint that adds a database | the history service the operator runs |
| `mcp` | one or more independently supplied observability records, and a client that speaks MCP over stdio | native evidence vocabularies and exact-identity cross-domain views, exposed to an agent |
| `help` | a readable workspace, built or not, and a client that speaks MCP over stdio | what a workspace publishes, ranked by what imports it and answered on demand |
| `observe` | the three it composes | one composition, shipped as an example |
| `tribunal` | a database, a bucket, and a runtime to deploy into | baselines, history, and the review-and-approve surface, in an account the operator controls |
| `cli` | all of it | the workflow, which is the one place a workflow belongs |

`tribunal` is the deliberate exception to the rule this table is about, and it is
listed here rather than left out, because a rule with an unstated exception reads
as a rule with none.
It is a **service**, not a linked tool: the requirement it names is a deployment
rather than something a consumer supplies to a function, and it composes five
packages because a deployed thing has to. It is named for what it is rather than
for the host it currently runs on, which is why
the row does not say `cloudflare`.

Four boxes require nothing at all, and hash, compare and isolate — the three
kinds the tool table shows needing nothing — all live in one of them. That is the
same economic argument arrived at from the other end, and it is what makes the
cheap tiers cheap in practice rather than only on paper: running the ephemeral
retention mode pulls in no filesystem and no socket, because the mode needs
neither.

Entrypoints are the second cut. `store/lfs` needs `git`; `history/client`
needs a network; `server/sqlite` needs `node:sqlite`; `report/file` needs a disk;
`playwright/agent` must be importable *without* Playwright, since it is bundled
into the page. In every case the split exists because the two halves cost
different things to have.

Two consequences worth stating, because they are the ones that get argued about:

- **A package may be small.** Splitting by requirement produces small boxes, and
  a small box with one requirement is better than a large one with four.
- **Package boundaries are structural.** Each package declares exactly the
  external requirements it uses, names its responsibility rather than an outside
  library, exposes resolvable entrypoints, and keeps the adopter-facing production
  graph acyclic without cross-package reach-through.

## What this forecloses

- A stage that only works inside the pipeline. If it cannot be exercised alone,
  it is not a tool and the seam is in the wrong place.
- A tool that reaches for what it was not given. Hidden inputs are why one
  machine's results do not reproduce on another's.
- Silent degradation. Every fallback is reported as a fallback, and a contract
  that quietly answers a weaker question is worse than one that fails.
