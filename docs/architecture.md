# Architecture

There is no pipeline. There are tools, and a pipeline is something a user
assembles from them.

Any fixed sequence encodes one team's workflow and fails the next. The unit of
design here is therefore the tool: a named thing with a declared contract that
can be reasoned about, replaced, and composed without reading the others.

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

Two of these need a host — a DOM to acquire from, a browser to render in.
Three need nothing at all. That distribution is the
whole economic argument, and it only exists because the kinds are separate.

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
in [`source.md`](source.md).

## The contracts

Five rules. A tool that breaks one is broken, whatever it produces.

**1. Declare what you need.** A tool states the cheapest tier that can answer its
question. A tier is then never charged for another tier's requirements — an
unloaded font cannot change which rules match, so the cheap rung waits for
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
takes only the reading end. The pieces below the chosen material do not know.

## Packages

**The primary cut between packages is what a consumer must supply, not what the
code does.**

A box is named for what it is for — a requirement the manifest cannot state, what
the thing is, or a target, format or protocol it serves, never a library it
imports ([ADR-0042](context/adr/0042-a-package-is-named-for-what-it-is-for.md)).
Code that needs one requirement may not sit with code that needs another.
Storybook support does not belong with Playwright helpers — not because they are
different features, but because a Storybook user would then install a browser and
a Playwright user would install a Storybook adapter, and neither asked for the
other. What something *does* is the second cut, made inside a box with
entrypoints.

| package | requires | holds |
|---|---|---|
| `core` | nothing | the format, the rules, comparison, attribution, verdicts, plans |
| `raster` | nothing | the pixel tier as data: assembly, contracts, policies, interventions, the gate |
| `report` | nothing | what a run leaves behind, so several readers can share one shape |
| `history` | nothing | what a row may contain, what the numbers mean, what to say with no store |
| `storybook` | a built Storybook's `index.json`, as a value | a project's own stories as a subject list |
| `storybook-collector` | a browser, and a Storybook built or already served | the browser half: each story opened, made ready, and collected |
| `route-collector` | a browser, and an application to reach or a directory to serve | pages an application already serves, opened and collected |
| `sense` | a readable checkout | the source read rather than run: a row per request, per binding and per export, and the probes that mark which regions a run entered |
| `package` | a readable workspace, built or not | what a package offers an adopter: every entrypoint a manifest opens, and the names behind it, read from manifests and the source they point at |
| `dom` | a live DOM | extraction, and CSS applicability pruning |
| `react` | React internals | fibers → owner chains, props digests, portals |
| `jsx-source` | a JSX transform you control, and a React runtime | the file and line that wrote an element, carried as far as the DOM node |
| `session` | a live DOM | many subjects in one standing world |
| `playwright` | a browser | the persistent harness, and a renderer |
| `playwright-test` | a browser, and a Playwright test run | additive observation and assertion helpers; optional unbound fixture and matcher parts |
| `unit-test` | a live DOM, and a writable artifact directory | resource-closed capture archives and a CLI collector for a later render process |
| `png` | a runtime with `Buffer` — Node, not a browser | decoding, comparison, the diff image |
| `png-sharp` | a runtime that can load a native addon, and a platform published for it | the same comparison, with the decoding done natively |
| `store` | a filesystem | baselines on disk, and in git-LFS |
| `remote` | a socket | a renderer and a store on the other side of a hop |
| `server` | a port and a bearer token; `server/sqlite` is the entrypoint that adds a database | the history service the operator runs |
| `mcp` | a run report that already exists, and a client that speaks MCP over stdio | the observation, exposed to an agent |
| `observe` | the three it composes | one composition, shipped as an example |
| `tribunal` | a database, a bucket, and a runtime to deploy into | baselines, history, and the review-and-approve surface, in an account the operator controls |
| `cli` | all of it | the workflow, which is the one place a workflow belongs |

`tribunal` is the deliberate exception to the rule this table is about, and it is
listed here rather than left out, because a rule with an unstated exception reads
as a rule with none.
It is a **service**, not a linked tool: the requirement it names is a deployment
rather than something a consumer supplies to a function, and it composes five
packages because a deployed thing has to. Named for what it is rather than for the
host it currently runs on
([ADR-0023](context/adr/0023-a-service-is-named-for-what-it-is.md)), which is why
the row does not say `cloudflare`.

Four boxes require nothing at all, and hash, compare and isolate — the three
kinds the tool table shows needing nothing — all live in one of them. That is the
same economic argument arrived at from the other end, and it is what makes the
cheap tiers cheap in practice rather than only on paper: running the ephemeral
retention mode pulls in no filesystem and no socket, because the mode does not
have one.

Entrypoints are the second cut. `store/lfs` needs a `git`; `history/client`
needs a network; `server/sqlite` needs `node:sqlite`; `report/file` needs a disk;
`playwright/agent` must be importable *without* Playwright, since it is bundled
into the page. In every case the split exists because the two halves cost
different things to have.

Two consequences worth stating, because they are the ones that get argued about:

- **A package may be small.** Splitting by requirement produces small boxes, and
  a small box with one requirement is better than a large one with four.
- **The rule is enforced, not documented.** `tools/boundaries.check.ts` fails when
  an import is undeclared, a declaration is unused, a name shares a word with one
  of the outside libraries the package depends on and nobody has written down
  which of the two it is, adopter-facing code reaches through one package of this
  scope to import another, the production graph gains a cycle, or an advertised
  entrypoint does not resolve.

## What this forecloses

- A stage that only works inside the pipeline. If it cannot be exercised alone,
  it is not a tool and the seam is in the wrong place.
- A tool that reaches for what it was not given. Hidden inputs are why one
  machine's results do not reproduce on another's.
- Silent degradation. Every fallback is reported as a fallback, and a contract
  that quietly answers a weaker question is worse than one that fails.
