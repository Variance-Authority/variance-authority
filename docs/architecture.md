# Architecture

There is no pipeline. There are tools, and a pipeline is something a user
assembles from them.

Any fixed sequence encodes one team's workflow and fails the next. The unit of
design here is therefore the tool: a named thing with a declared contract that
can be reasoned about, replaced, and composed without reading the others.

## Kinds of tool

| Kind | Takes | Gives | Needs |
|---|---|---|---|
| **acquire** | a live tree | a document — markup plus the CSS that applies to it | a DOM |
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

## What flows between them

Values, never handles. Every tool takes and returns something serializable, which
is what lets any hop become a network hop — a document acquired in a unit test
can be rendered on a machine that pins its pixels, and nothing in the design has
to know that happened.

```
document → identity → raster → difference → places → components → verdict
```

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

**4. Never loop to make a problem go away.** Re-observing until two observations
agree hides the finding, costs the most expensive step twice, and buys a green
run that teaches nobody anything. Detect on the cheap tier, refuse to proceed,
and name the component and the file. The fix belongs in the subject and is paid
once; a wait belongs to every subject forever.

**5. Order is the caller's.** Tools compose in whatever order their types allow.
This repository ships compositions as examples, not as the product.

## Compositions

Assembled from the same tools, and none is privileged.

**Cheap gate.** acquire → hash → compare against a stored identity. Answers
"anything to do?" with no browser at all. A suite where two subjects changed pays
for two.

**Full observation.** acquire → prepare → render → compare → isolate → map →
judge. What a change costs when the cheap gate cannot settle it.

**Stability check.** acquire twice → compare → map. No render. Catches a subject
that will not hold still, and names why, before any image exists.

**Extension.** A team with Playwright tests already keeps their capture and takes
compare, isolate and map. A team with images from elsewhere takes only the reading
end. The pieces below the one they replace do not know.

## Packages

**The first cut between packages is what a consumer must supply, not what the
code does.**

A box is named for its requirement, and code that needs one requirement may not
sit with code that needs another. Storybook support does not belong with
Playwright helpers — not because they are different features, but because a
Storybook user would then install a browser and a Playwright user would install a
Storybook adapter, and neither asked for the other. What something *does* is the
second cut, made inside a box with entrypoints.

| package | requires | holds |
|---|---|---|
| `core` | nothing | the format, the rules, comparison, attribution, verdicts, plans |
| `raster` | nothing | the pixel tier as data: assembly, contracts, policies, interventions, the gate |
| `report` | nothing | what a run leaves behind, so several readers can share one shape |
| `history` | nothing | what a row may contain, what the numbers mean, what to say with no store |
| `storybook` | nothing | a project's own stories as a subject list |
| `dom` | a live DOM | extraction, and CSS applicability pruning |
| `react` | React internals | fibers → owner chains, props digests, portals |
| `session` | a live DOM | many subjects in one standing world |
| `playwright` | a browser | the persistent harness, and a renderer |
| `png` | a PNG codec | decoding, comparison, the diff image |
| `store` | a filesystem | baselines on disk, and in git-LFS |
| `remote` | a socket | a renderer and a store on the other side of a hop |
| `server` | a database | the history service the operator runs |
| `mcp` | stdio | the observation, exposed to an agent |
| `observe` | the three it composes | one composition, shipped as an example |
| `cli` | all of it | the workflow, which is the one place a workflow belongs |

Five boxes require nothing at all. That is the same distribution the tool table
shows, arrived at from the other end, and it is what makes the cheap tiers cheap
in practice rather than only on paper: running the ephemeral retention mode pulls
in no filesystem and no socket, because the mode does not have one.

Entrypoints are the second cut. `store/lfs` needs a `git`; `history/client`
needs a network; `server/sqlite` needs `node:sqlite`; `report/file` needs a disk;
`playwright/agent` must be importable *without* Playwright, since it is bundled
into the page. In every case the split exists because the two halves cost
different things to have.

Two consequences worth stating, because they are the ones that get argued about:

- **A package may be small.** `png` is three files and two entrypoints, and was
  one file until a second comparator arrived. Splitting by requirement
  produces small boxes, and a small box with one requirement is better than a
  large one with four.
- **The rule is enforced, not documented.** `tools/boundaries.test.ts` fails when
  an import is undeclared, a declaration is unused, a third-party requirement
  gains a second owner, the production graph gains a cycle, or an advertised
  entrypoint does not resolve. It found four packages' worth of drift the first
  time it ran.

## What this forecloses

- A stage that only works inside the pipeline. If it cannot be exercised alone,
  it is not a tool and the seam is in the wrong place.
- A tool that reaches for what it was not given. Hidden inputs are why one
  machine's results do not reproduce on another's.
- Silent degradation. Every fallback is reported as a fallback, and a contract
  that quietly answers a weaker question is worse than one that fails.
