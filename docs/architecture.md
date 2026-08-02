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

Two of these need a browser. Two need nothing at all. That distribution is the
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

## What this forecloses

- A stage that only works inside the pipeline. If it cannot be exercised alone,
  it is not a tool and the seam is in the wrong place.
- A tool that reaches for what it was not given. Hidden inputs are why one
  machine's results do not reproduce on another's.
- Silent degradation. Every fallback is reported as a fallback, and a contract
  that quietly answers a weaker question is worse than one that fails.
