# Compose an observation

Start with the process that already knows how to reach the state. Then choose
the evidence your question needs, where pixels should be made, and where the
answer should live. These choices can be combined without rebuilding the
working parts of your test or review setup.

## Four choices remain independent

| Decision | What it changes | Route |
| --- | --- | --- |
| Which process reaches the state and declares it ready? | Lifecycle, discovery, and subject naming | [Choose a composition](cases.md) |
| What is acquired, and where are pixels made? | Portability, privacy, semantic evidence, latency, and renderer identity | [Choose the surface](surface.md) |
| Where is the answer consumed and retained? | Infrastructure, review, and how long evidence remains available | [Choose an operating flow](flows.md) |
| Is comparison ephemeral or durable, and who owns the baseline? | Lookup, promotion, and storage responsibility | [Place the baseline](placement.md) |

A Storybook host does not imply local rendering. A Playwright host does not
imply in-place pixels. A remote store does not make a verdict more correct.
Changing one choice must not silently choose the others.

## Start from what already owns the state

Use the host that already knows how to reach the subject and when it is ready.
Then choose the smallest acquisition material and evidence flow that can answer
the outcome. Existing collectors, rasters, stores, and review systems may fill
those roles when they preserve the observation contract.

The paths meet at shared observation, comparison, retention, and reporting
interfaces. They need not produce identical evidence.

## The composition sets the evidence boundary

Browser accessibility, component provenance, resource closure, live
announcements, and in-place paint are available only when the selected surface
and vantage supply them. Their absence reduces what the observation can support;
it does not become an empty reading.

The result is one composition suited to the question. Add another host,
instrument, renderer, store, or consumer only when another decision needs it.
