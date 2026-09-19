# Architecture

Three questions decide how much machinery you need: is there anything to do at
all, what exactly changed, and will this **subject** — one named UI state you
point the tools at, a story, a route, a fixture or a value — even hold still.
One set of tools covers all three, and this page is how they fit together and
which package holds each.

The unit you adopt is the tool: a named capability you can understand, replace
and compose without learning the implementation of the others. Lifecycle,
rendering, storage and review stay with the systems and people that already own
them in your project.

## Three compositions, and what each one costs you

The same tools, assembled three ways. None is privileged, and you can run one
without the others.

### Cheap gate

`acquire → hash → compare against a stored identity`. Answers "anything to do?"
with no browser at all. A suite where two subjects changed pays for two.

```bash
variance run --since origin/main
```

Subjects the diff cannot reach are ruled out by name, with the reason:

```
[not observed] story:checkout--summary
not affected by the diff against origin/main: its baseline records 4 component(s)
and this diff touched none of them (Button, Badge, Toggle)
```

Of the subjects that survive that cut, one whose document digest equals the
digest its baseline was painted from is settled on those 32 hex characters
without painting anything.

### Full observation

`acquire → prepare → render → compare → isolate → map → judge`. What a change
costs when the cheap gate cannot settle it.

```bash
variance run
variance report --format html > .variance/report.html
```

One card per subject that needs a decision: the subject id, the changed region,
the component that drew it, the `file:line` it was written at, and a paste-ready
`variance accept` line. [Run visual review from the command line](start-cli.md)
walks the loop.

### Stability check

`acquire twice → compare → map`. No render. Catches a subject that will not hold
still — one that reads differently twice in a row with nothing changed between
the two reads — and names why, before any image exists.

```bash
variance run --flakes
```

```
[unstable] story:case-surface--ticking: … Clock src/ds.jsx:118 read differently
  (geometry, token, content)
```

It costs one collection per subject and never a render, so 300 subjects is 300
cheap collections. Unstable subjects exit `1` even when every verdict is green.

### Extension

You keep the runner you have. A team with Playwright tests chooses an in-place
raster or a deferred document without replacing it. A browserless unit suite
writes a document archive for a later browser process. A team with images from
elsewhere takes only the reading end. Nothing below the material you chose learns
which of the three it was.

## Kinds of tool

Nine kinds. A kind is not something you invoke — there is no command and no
config key for one — so the last column is where each shows up in what you read.

| Kind | Takes | Gives | Needs | You meet it when |
|---|---|---|---|---|
| **acquire** | a live tree | capture material — a document or an in-place raster | a DOM or browser | a subject is reported failed with the sentence your collector refused it with |
| **prepare** | a subject | a subject that reads the same twice | varies; each declares its own | a baseline made under a different recipe comes back `incomparable` rather than as a diff |
| **render** | a document | pixels | a browser, here or elsewhere | `variance doctor` prints the renderer as `available` or `NOT AVAILABLE` with the launch error |
| **hash** | anything | an identity | nothing | a run finishes having painted nothing, because the digests matched |
| **compare** | two of a kind | a difference | nothing | the verdict on a subject is `changed` and a diff image lands beside the report |
| **isolate** | a difference | changed regions, each with its box | nothing | the report card highlights a region instead of handing you two whole images |
| **map** | regions | components, then files | a snapshot | the failure line names the component and the `file:line` that wrote it |
| **judge** | everything above | a verdict | a policy | the per-subject verdict and the exit code your CI job gates on |
| **record** | a verdict | an artifact, or a row that outlives the run | a store | `.variance/report.json`, the PNGs beside it, and the history rows a later run reads back |

Two of these need a host — a DOM to acquire from, a browser to render in. Three
need nothing at all, which is what makes the cheap gate above cheap.

**prepare** is a set rather than a stage. A **trick** is one named action that
holds part of the page still: a reset puts the page into a known state, a hold
stops something that would keep moving, a wait blocks until something outside
the page's control lands, a support removes something present that must not be
measured. Each trick declares the cheapest tier that can observe its effect and
the one property it governs, and a **recipe** is the list of tricks a run applies
([holding a page still](stabilization.md)). Two tricks over one property is a
conflict the run reports, not a precedence rule it invents.

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
document → identity → raster → difference → regions → components → verdict
```

The three hops from `difference` to `verdict` are one chain, and
[`attribution.md`](attribution.md) writes each of them out. The chain never
starts unless selection let the subject through, and the source graph selection
reads is in [`source.md`](source.md). [`information.md`](information.md) is the
reference for what each output holds, how long it is kept, and which outputs
merge with which.

## The contracts

Five rules. A tool that breaks one is broken, whatever it produces. Each one
shows up in your output as a specific line.

**1. A tool declares the cheapest tier it needs.** A **tier** is one of four
rungs, ordered by cost: `reachability`, `semantic`, `layout`, `raster`. A run
reaches one of them — `profile: "jsdom"` stops at the semantic rung and
`profile: "chromium"` reaches the raster rung — and `variance doctor` prints
which, before the first expensive run. A tool that needs a rung the run is below is named as
unable to do its job rather than allowed to answer from less. The rule also runs
the other way: a tier is never charged for another tier's requirements, so the
cheap rungs wait for no fonts and no images, because neither can change which
CSS rules match or what they declare.

**2. Anything that could change the answer is part of the result's identity.**
The machine, the engine, the scale factor, the fonts, the tricks applied. Two
results whose identities differ come back as one word:

```
incomparable
```

The report names which part of the identity differs. It never means zero
difference, and it is never rendered as a diff — a difference in conditions
reported as a difference in your product is a confident wrong answer.

**3. Not measured, measured as zero, and unobservable are three states.** The run
prints which of the three it is rather than collapsing any two into a pass. When
a reading was never taken, the answer says so on its own line:

```
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).
```

When the profile could not observe a band, that band reports `unobserved` beside
the verdicts instead of folding into `unchanged`. A miss you can read as "never
measured here" is a different fact from "measured, found nothing", and you act on
them differently.

**4. Re-observing never makes a problem go away.** Repeated reads may classify
stability, but every scheduled read counts and any disagreement refuses the
candidate rather than taking the attempt that happened to agree. So a retry
budget will not turn a red build green for you, and a subject that disagrees with
itself surfaces as `[unstable]` with the component, the `file:line` and the bands
that changed — on the cheapest tier that could see it.

**5. Order is yours.** Tools compose in whatever order their types allow. The
three compositions above are supported offerings, not one mandatory pipeline.

## Packages

**You install only what your setup already has. Check the `requires` column
before anything else.**

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
| `eyes` | a live DOM, with optional RTL or Playwright host APIs | selector and locator attention with React attribution captured before the addressed node changes |
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
| `vitest-browser` | a Vitest browser-mode run, and a browser for the deferred paint | one observation per mounted component, read in the tab and judged in the runner's own process |
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

Four boxes require nothing at all, and `hash`, `compare` and `isolate` — the
three kinds that need nothing — all live in one of them. Running the ephemeral
retention mode pulls in no filesystem and no socket.

Entrypoints are the second cut, and each one exists because the two halves cost
different things to have. `store/lfs` needs `git`; `history/client` needs a
network; `server/sqlite` needs `node:sqlite`; `report/file` needs a disk;
`playwright/agent` is imported by the bundle that runs inside the browser page,
so it pulls in no Playwright and nothing Node-only.

## Your logs will be noisy, on purpose

Every fallback is reported as a fallback. A run that could not do the expensive
thing and did the cheap thing instead says so on the line, rather than answering
a weaker question under the same heading. Do not filter those lines out: they are
the difference between a green build that checked what you asked for and one that
checked less.
