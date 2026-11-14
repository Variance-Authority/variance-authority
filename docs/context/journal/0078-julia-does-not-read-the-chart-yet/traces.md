# M-dom1 — domain-language traces over 8 open specs

Each spec below is read against `.compass/variance-authority` at `5e093042` only: DOMAIN.md, GLOSSARY.md and the block Responsibility/Boundary sections. No history or code is consulted, except where a spec itself names a file. Each step is tagged with its type (S1–S7, defined at the end).

## 0023 — `accept` tells a new baseline from a changed one

1. **S7 acts.**
   - "promote a candidate" is *decide*.
   - "tell new from changed" is *read a verdict*, not compute one.
2. **S1 terms.**
   - *accept/promote* → Approval (Identity and retention) and Decision (Review).
   - *new*, *changed* → Verdict lifecycle states (Adjudication). They already exist, so nothing needs coining.
3. **S2 invariant at stake.** Verdict: "a green verdict is never one word … absorbed is spelled differently from unchanged". The spec asks for the same discipline one step later: an acceptance must not be one word either. Decision: "a subject where something else also moved is refused by name" is the precedent for a keystroke that refuses rather than promotes.
4. **S3 boundaries.**
   - retention: "decides nothing and gates nothing". Excluded.
   - adjudication: "does not aggregate for a person". Excluded.
   - review: "turns one named person's answer … into the baseline it moves". **Owner.**
5. **S4 walk.** The verdict reaches review over Report → Review (published language), and Verdict's lifecycle already includes `new`. No producer changes: a consumer-only change.

## 0024 — what a prop controls

1. **S7 acts.**
   - "a digest per prop" is *identify/hash* (observation).
   - "which prop moved these bands" is *attribute a cause* (adjudication).
2. **S1.** *props digest*, *component instance* → Component hash and Digest (Observation). *unexplained* → the cause ladder (Adjudication: Cause).
3. **S2, as a constraint rather than a repair.** Component hash: "a container's identity may not depend on what it was handed". So per-prop digests must be evidence beside the identity, never folded into it. Digest: "names every input that can reach what it identifies" holds, because the props already sit outside the component's own band hashes.
4. **S3.**
   - normalization: "applies no operator policy". Splitting a digest is not policy, so the hash side is allowed there.
   - adjudication: "never infers cause from a pixel". Band digests are not pixels, so the rung is allowed.
5. **S4 split across the edge Observation → Adjudication.**
   - Producer: carry per-prop digests.
   - Consumer: a new rung above `unexplained`.

## 0032 — a render nobody committed (feature flags)

1. **S2 symptom → violated invariant.** This is the step the spec turns on.
   - Symptom: two pages that differ by a flag "meet under one baseline, and their disagreement is reported as a change with a component and a file:line".
   - Renderer identity: "the content hash of every input that can reach a pixel". A flag reaches a pixel and is missing, so identity is incomplete.
   - Cause: "a difference that an excluded input could explain is refused rather than reported with a hedge". Today it is reported without even a hedge.
2. **S7 acts.**
   - *read the flag state* is acquisition (material from the live host).
   - *fold it into identity* is materialization/renderer-identity.
   - *refuse a cause the flag could explain* is adjudication.
3. **S3.**
   - acquisition: "owns no policy … not the stabilization recipe". Reading a value is not policy, so allowed.
   - retention: identity "partitions the store structurally", and retention only keeps. It is touched by consequence, not by edit.
4. **S1.** Profile: "a dimension the reader could not observe is absent". A flag nobody read is *unobserved*, never *off*. This settles the default.
5. **S4.** One input travels acquisition → materialization identity → adjudication refusal: three owners, one edge chain.

## 0035 — a flake proven by what the run did not execute

1. **S1 sense collision.** *flake* is Stability's word: "read differently twice, and did so again when asked again". The spec proposes flake evidence without a second reading, so either the concept's definition extends or a new verdict is coined. That choice is the spec's real decision, and the chart puts it in front of the reader.
2. **S1 again.** *coverage index* / *which tests entered which regions* → Crossing and Journey (Reach), not Retention's "the record" (churn and recurrence). Two things are called a record.
3. **S2.**
   - Crossing: "an edge no execution witnessed is absent rather than impossible", and "a truncated recording is dropped". So *did not execute* is evidence only over a complete recording.
   - Journey: "silence does not narrow". A missing participant cannot prove a flake.
4. **S3.** Stability is a conformist to adjudication's vocabulary (context map), so the new rung is written in adjudication. Stability's boundary, "does not retry … neither clears anything", survives, because this rung replaces no second reading. The spec says so: `again` and `alone` stay.
5. **S4 edge Reach → Adjudication.** The context map has no direct arrow for it; Reach reaches Report, and Observation reaches Adjudication. **This is a new edge**, which a walk would report as missing. That is a chart finding, not a failure.

## 0045 — the execution record says what it is, how old it is, and whether it is intact

1. **S5.** The spec names `format-layout.ts` and `format-view.ts`. A coordinate lookup answers the owner directly, and no reasoning is needed.
2. **S1.** *execution record* is Reach's, not Retention's "the record". The same collision as in 0035.
3. **S2.**
   - Crossing: "a truncated recording is dropped from the pool rather than counted as a miss". A reader that cannot tell a corrupt file from an old one cannot drop the right thing.
   - Report reading: "a reading that cannot be complete refuses to look complete".
   - Both support distinct refusals for foreign, stale and damaged files.

## 0048 — a worker that dies says so

1. **S7 acts.**
   - *carry crossings out of a worker process* is runtime: "carries what running software says … out of the process holding it".
   - *fold journals into a record* is reach.
2. **S2 with polarity.**
   - "one reporter answers an unknown module id in the narrowing direction" violates Journey's "silence does not narrow".
   - "throws for the whole run and names nothing" violates Report's "declare what you did".
   - The first is a safety defect and the second is a legibility defect, so the two differ in severity. This is a judgement that has to know which *direction* is unsafe.
3. **S3.** runtime: "nothing on a default path is written down". Journals are written, so is runtime the wrong owner for the write? The boundary names the scenario archive as its one keeping component. The journal write therefore sits on reach's side of the edge, or it is an unlisted exception. **A boundary tension to classify** (semantic change, remapping or violation), not to resolve here.
4. **S4 split across the edge Runtime → Reach.**

## 0051 — a sensitivity is scoped by id and nothing else

1. **S5.** `packages/core/src/judge/scope.ts` is named, so the lookup gives adjudication.
2. **S6 contrast with the nearest concept.**
   - The spec defines the missing axis against Ignore: "not a pixel region — that is an ignore". Ignore: "names a place … never a rectangle"; "an ignore is not a tolerance".
   - A place-scoped sensitivity is a third thing: a *kind of change* asserted *per place*. The trace has to hold three siblings apart: ignore (a place excluded), tolerance (a threshold) and sensitivity (a kind asserted).
3. **S3, the negation trap.** normalization's boundary says "a **sensitivity** is never read here". Lexically, normalization is the block whose text mentions *sensitivity*. Read with negation, it is the one block excluded by name.
4. **S2.** Presentation finding: "reading defaults to one owner and its immediate children; folding a subtree … is an explicit decision". A per-place scope must say its grain explicitly, never inherit it.

## 0012 — order dependence in a run

1. **S1.** *clean world* and *re-collect* → Second reading (Stability), the one that "rebuilds the world and holds time". *order-dependent* is a Verdict lifecycle state.
2. **S2.** The spec's central argument is the Provenance invariant: "causality runs one way … cause is never inferred backwards from a pixel". A DOM probe cannot name a module-scope writer, so the naming promise is refused. The chart states this argument before the spec does.
3. **S3, a positive routing clause.** stability: "does not keep the record of how often a subject has read differently, which belongs to retention". The spec's remaining "history" half is routed by the boundary itself.
4. **S4.** Stability (sharpener) and retention (history) are two owners, joined over Stability → Adjudication → Retention.

## Step types

| | Step | Input → output | Kind | Lexical enough? |
|---|---|---|---|---|
| S1 | Term → concept, **with sense choice** | a clause → one sense of an owned word (record ×2, reading ×2, flake) | judgement, 2–4 options | no: the collisions share their spelling |
| S2 | Symptom or act → **the invariant at stake**, and whether it is repaired, risked or a constraint | a clause → 1 of ~60 invariant sentences, plus polarity | judgement, few options after S1 narrows | weak: 0032's symptom shares almost no words with "every input that can reach a pixel" |
| S3 | Act → block **by boundary**: forbids / routes to / allows | an act × a boundary clause → {forbids, routes-to Y, silent} | judgement | **no**: 0051's normalization clause is a lexical hit and a semantic exclusion |
| S4 | Owners → the edge chain on the context map; a missing edge is a finding | graph walk | walk | n/a |
| S5 | Named file → block by coordinates | lookup | walk | n/a |
| S6 | New concept → nearest sibling, and the invariant that separates them | a clause × sibling definitions → which one, and why not the other | judgement | no: the siblings share vocabulary by construction |
| S7 | Work → acts, each a domain verb (observe, normalize, paint, compare/attribute, keep, decide, carry, select, report, trust, present) | a clause → 1 of 11 verbs | judgement | partly: block boundaries are written *as* these verbs ("observes nothing, paints nothing, compares nothing") |

## What the traces show

- **The domain's language is verbs with owners and negations.** Every block is cut by what it does and, just as sharply, by what it does not ("observes nothing, paints nothing, compares nothing, issues no verdict"). The reasoning is:
  1. break the work into acts (S7);
  2. give each act to the one block whose responsibility claims it and whose boundary does not forbid it (S3);
  3. check the invariants each act touches (S2), after fixing which sense of each owned word is meant (S1, S6);
  4. walk the edges between the owners (S4, S5).
- **Walks are cheap and algorithmic** (S4, S5).
- **Judgements are local:** one clause, one question, 2–12 options. That is Julia's row shape.
- **Where BM25 fails structurally:**
  - negation, in S3 (0051);
  - symptom-to-invariant distance, in S2 (0032);
  - same-spelling senses, in S1 (record, flake).
  These are properties of the language, not of the data volume.
- **Chart findings the traces surfaced** (Consume: recorded, not edited):
  - 0035 needs a Reach → Adjudication edge the context map lacks;
  - 0048 meets runtime's "nothing on a default path is written down" against journals written by workers.

## Lexical check (ft/bm25_blocks.py, spec head 40 lines vs 11 block READMEs)

The gold labels are the owners from my own traces. They are not independent.

- BM25 puts a gold owner first for **4 of 8 specs**: 0035, 0045, 0048, 0051. The first gold owner's mean rank is 1.75.
- **0051: my negation trap is weaker than claimed.** BM25 puts adjudication first. Normalization, the block excluded by name, is second: the trap is visible but does not flip the top.
- The misses are 0023 (review is 4th), 0032 (materialization is below acquisition), 0012 and 0024. Each miss is a spec whose owner is named by a *verb*, not by a noun the spec repeats.
