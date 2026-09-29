# Spec 0084 — independent judgments orient the code map

**Missing:** no controller asks independent relevance questions over one
published map state, scores plausible descendants before their parents are
selected, or joins those judgments to deterministic code search. A sequence of
one model choice per tree edge pays a request round trip for information the
index already holds.
**Built on:** [spec 0083](0083-the-code-map-offers-choices.md) (bounded,
addressable candidates), the published source index and code map, and the case
recording where one exists. This is a separate consumer of orientation data,
not a change to what `orient --files` accepts or claims.

## Purpose

The controller uses a fast local model only for semantic judgment: given a
task and real candidate places, which are plausibly useful? The graph owns the
places and relations. Code builds the candidate set, fans out independent
questions, applies parent premises, fetches indexed evidence, and composes the
ranked result. The agent receives paths and source locations to inspect and
owns interpretation, editing and tests.

The primitive is **many independent judgments over shared state**, including
speculative judgments about descendants. It is not a generative next-action
request or a reranker over one already narrowed list. No model generates a
file path, explanation or graph edge. A typed judgment adapter allows local
models to be compared on the same candidate set. No search sends source to an
external model service.

## One map request

The first semantic request carries the task and the bounded map slice from
spec 0083: roots, children of each root and, where capacity allows, package
summaries beneath them. It asks one independent multi-label relevance question
per candidate, including candidates under roots that may later be rejected.
Each child question states its premise explicitly: *if this parent is explored,
is this child plausibly useful for the task?* The runtime can execute these
questions over the shared state in parallel. Code ignores a child's answer
when its parent route is not pursued.

For a Jev adapter, map relevance uses one `Noul` per candidate and evidence
view, not one `Choice` among siblings. Several branches may be relevant. A
false answer for one candidate means only that candidate was not selected
under that question and view; it is not a finding that the repository has no
answer. The adapter returns candidate IDs and typed judgments, never free-form
destinations. A different local model may expose another primitive, but it
must preserve independent, comparable questions and the same IDs.

The **name and place** and **relation** views ask about the same candidate IDs
independently. A third view needs a distinct owner-provided signal, such as a
recorded case or known trace location. Rewording one view three times is not
three sources of evidence. Code preserves the union of routes supported by
either view; agreement can raise scheduling priority, but averaging cannot
erase a route one view found.

The controller selects two to four promising scopes and retains the remaining
candidate judgments as alternatives. It can pursue the selected scopes
concurrently. It need not call the model again to open a child whose relevance
was already judged. A cycle, leaf or locally rejected candidate closes only
that route; another selected or saved route continues. If no candidate is
selected, the controller can inspect unscored partitions or other indexed
starts and reports any scope it did not inspect.

## Evidence request

Code runs deterministic indexed `search`, `symbol`, `uses`, `grep` and `orient`
queries in the selected scopes in parallel, as each tool's available contract
allows. This constructs new evidence: symbols, declarations, documentation
and exact source locations. A second semantic request is warranted because
that evidence depends on the selected scopes and was not in the first state.

For graded symbol ordering, a Jev adapter asks one comparable `Score` per
candidate symbol, not a `Choice` over the whole list. Its anchored scale is:

| Score | Meaning |
|---|---|
| 0 | Unrelated to the task |
| 1 | Weakly adjacent |
| 2 | Useful supporting context |
| 3 | Directly involved |
| 4 | Likely source of truth or implementation boundary |

Every symbol receives the same question, scale and evidence rules. Code orders
the results and keeps the score beside the indexed source that was scored. A
score is neither a calibrated probability nor proof that an unscored symbol is
irrelevant. Missing evidence remains absent, not a zero score.

## Serial-request rule

A later semantic request is made only when an earlier answer is needed to
fetch new evidence, construct new state or determine options that could not
have been stated speculatively in the previous request. Capacity limits may
split independent questions into additional batches, but do not make them a
dependent chain. Every serial request records its reason, the new state it
needed, and whether its questions could have been prepared earlier.

The first experiment targets one map request, parallel deterministic lookup,
and one evidence request per task when the bounded states fit. Two semantic
round trips are a hypothesis to measure, not a promise for every repository.
Question count, state bytes, capacity splits and wasted speculative judgments
are part of the cost. The controller keeps paths, visited IDs, alternatives
and index generations; the model input does not carry a traversal transcript.

## Handoff and failure

The answer names the index generation, model identity and version, candidate
coverage, selected scopes, exact graph paths, discovered symbols and source
locations, and the evidence view and score that elevated each result. It
distinguishes structural evidence, recorded execution, model judgments and
uninspected scope. The agent can inspect the named files and ask `orient
--files` about them without repeating the search.

An unavailable model or failed batch is reported as unavailable, separately
from a valid low relevance judgment. Existing deterministic `search`, `symbol`,
`grep` and `orient` commands remain usable. A budget limit reports the
unscored candidates rather than treating them as rejected.

## What would discharge it

1. A controller with a fixed judgment adapter demonstrates that root,
   descendant and package questions over shared state can be submitted
   together; parent premises filter their answers afterward; two to four
   selected scopes launch parallel deterministic lookup; saved routes survive
   a dead end and cycles do not create false negatives.
2. An adapter for at least one local model, with pinned weights, runtime,
   input format, question order and score scale. The CI path runs without an
   outbound model call and distinguishes model absence from low relevance.
3. Held-out tasks with reviewed target files and a map built from each task's
   pre-change checkout. Include no lexical match, misleading sibling areas,
   several valid routes and no answer in indexed scope. Report candidate
   recall separately from judgment recall, target-area, package and file
   recall, first useful source, missed routes and incomplete coverage.
4. Compare serial edge-by-edge choice, one view, two views and speculative
   fan-out at matched candidate and evidence budgets. Also compare indexed
   lexical search alone. Record where speculative judgments save a round trip
   and where their state or question cost outweighs it. The second view earns
   its place only if it improves recall without losing a target the first
   view found.
5. Measure warm end-to-end latency on Kibana and the seven-copy MUI corpus,
   plus a local Mac and a CPU CI runner, with startup separately. Report p50,
   p95, semantic round trips, model and deterministic lookup time, question
   count, state bytes, batch occupancy, capacity splits and handoff size.
   Throughput across independent judgments is not substituted for one task's
   elapsed orientation time.

The experiment tests whether speculative, independent judgments over the
graph's actual options find useful code faster and more reliably than serial
navigation or indexed search alone. It does not claim that a small model
understands a codebase.
