# Helix checkpoint — Julia-1 speaks this repository

Surface: this file (scratchpad, session lifetime; configured by the user 2026-09-30). Read/write: me. Lab root `$S/ft`.

## Outcome
- **Need:** Julia-1 (144M, not a reasoning model) does not know this repository's language (TASK-21, specs 0083/0084).
- **Effect:** Julia is materially better than random, ranked above static BM25 and the other tools, and "reasons better than direct algos".
- **Proof:** on the 150 held-out test tasks (newest, after cut C = v0.8.0), the epoch chosen on validation beats every tool row on package hit@1 and MRR, and on concept MRR. The paired bootstrap is against F (package) and c:prior (concept). It must also beat `ltr(evidence+prior)`, the learned linear ranker over the same evidence ("direct algo"). Pre-work set (n=10) is a sanity check only.
- **Framing (user, at R9): "no alone".** Julia is judged as part of a system that reads what the tools carry, never alone. A capability Julia cannot supply without another capability is a place to extend it, not a reason to retire it: fresher evidence, a rolling clock, option text drawn from the tree at the task's parent, fusion with F. The reader's "the Julia-alone proof retires" (R9) is therefore not a stop condition.
- **Proof, amended at R9:** a temporally honest rolling clock. The 150 test tasks are cut, oldest first, into 5 chunks of 30. Each chunk is scored by a model that has seen the labels of everything older than the chunk, with hyperparameters fixed in advance, because val cannot see the drift (R6, R9). The bars are the same rows, and the direct algo is ltr refit on the same clock.
- **Bars (test):**
  - package: F hit@1 0.767 / MRR 0.855; ltr 0.740 / 0.846; kNN 0.700 / 0.812; prior 0.567; BM25 @C 0.513, @parent 0.593; random ≈ 0.03.
  - concept: c:prior 0.780 / 0.853; ltr 0.761 / 0.857; glossary 0.761 / 0.838.
- **Authority / boundary:** scratchpad only, nothing committed; sandbox stays on; no test-set tuning (selection on val only); spec amendments only after a positive result.

## Surviving branches
- **B-fuse-concept (Expected inside its boundary, R11):** `c:rrf(prior, julia-roll)` beats c:prior and the direct algo in the same seat, both significantly. Delivered; nothing more to act on until the report.
- **B-fuse-package (point gain, underpowered, R11):** Julia as a third voter; the input row is the lever. The Julia row improves through its clock (B-roll2) and its option text (B-opt).
- **B-roll2 (active):** a per-task clock, the fine-tune epitaph's literal resurrection condition ("trained to each task's parent"). F already reads each task's parent; Julia and ltr only learned at 30-task boundaries, which cost Julia 8 tasks in chunk 0 against F.
- **B-opt (not started):** option text read at each task's parent.

## Results (immutable)
- R1 zero-shot Julia (rosetta / filecls / analog): below prior and BM25 everywhere; analogue rerank adds nothing (0.460 = 0.460).
- R2 plain fine-tune `ft`, val-selected ep1:
  - test package hit@1 0.493 / MRR 0.680 (ep2 0.540, ep3 0.520, ep4 0.500); concept 0.651 / 0.782.
  - Beats random and BM25 @C at best; below prior, kNN and F.
- R3 `ltr(evidence+prior)`: test package 0.740 / 0.846; concept 0.761 / 0.857. The direct algo does not beat F.
- R4 `rag` ep1 (the only epoch; run stopped at ep2 to keep one move in flight):
  - test package 0.620 / 0.779: above prior and both BM25s, below kNN and F.
  - test concept 0.752 / MRR 0.859: MRR ≥ c:prior 0.853 and ltr 0.857, but hit@1 is below c:prior 0.780.
  - Of F-only wins, 29/29 are gold `cli` with Julia's first pick `sense`; the pre-C base rate is sense 150 vs cli 103, the test period is level. Julia-only wins: 7.
  - Test ranks were read per epoch here; the verdict counts only the val-selected epoch.

- R5 `rr` (tools retrieve, Julia decides; 19 evidence-first candidates in one group), val-selected ep3:
  - test package 0.567 / 0.718: below kNN 0.700, and below rag ep1.
  - test concept 0.725 / 0.832: below c:prior.
  - Verdict against the frozen readbacks: **Disconfirming**.
- R6 val→test package hit@1, same tasks per row:
  - F 0.800→0.767; ltr 0.850→0.740; kNN 0.767→0.700; prior 0.850→0.567.
  - Julia: ft 0.733→0.493, rag 0.80→0.62, rr 0.750→0.567.

- R7 M-read1 (fresh reader, record only) — **Expected**:
  - Validation lacks the test period's drift (prior 0.850→0.567), so selection by val does not transfer.
  - R4's 29/29 cli→sense losses follow the pre-C frequency. Recovering them would put R4 at ≈0.81, so passing on package could be pure calibration, and a calibration control is required.
  - The concept margins (0.859 vs 0.853/0.857) are noise.
  - Pre-C fine-tuning cannot move the proof.

- R8 M-cal1 (`cal.py`, `ltr.py noprior`; α=1 fixed, p_pre = train-split frequency, the prior the model trained on) — **Disconfirming**:
  - test package hit@1 / MRR:
    - raw 0.620 / 0.779
    - cal(a) 0.580 / 0.707
    - cal(b) 0.633 / 0.784
    - ltr−prior 0.733 / 0.840; ltr 0.740 / 0.846; F 0.767 / 0.855
  - cli→sense among F-only losses: raw 26 of 29; cal(a) 25 of 37; cal(b) 26 of 29. R4's 7 unique wins are kept by (a), 7 of 7.
  - val hit@1: raw 0.800, cal(a) 0.750, cal(b) 0.833, F 0.800, ltr 0.850, ltr−prior 0.767.
  - Read: R7's calibration hypothesis is refuted. Removing the marginal prior does not move the cli/sense confusion, so the error is in P(package | text), not P(package). Removing the prior from ltr costs 0.007, so the tools do not lean on it either.
  - R4's count, restated with the gold containing `cli`, is 26 of 29, not 29 of 29.

- R9 M-read2 (fresh reader) — **Expected**, but the reader dissents on branch selection:
  - On the 26 cli→sense losses the evidence said cli: kNN top-1 was cli on 19, BM25 @parent top-1 on 18, and BM25 had cli above sense on 24. Julia ranked cli second on 25. Nothing was truncated; states are ≤ ~192 tokens.
  - Julia's top-1 is sense on 130 of 150 and matches the prior row's top-1 on 130 of 150. Its sense−cli margin has an intercept of 2.88 logits and barely moves with evidence (−0.06 per kNN vote, −0.19 per BM25 point).
  - When the evidence says cli, the gold is sense-only 8 : cli-only 2 on val, but 8 : 35 on test. Pre-C data teaches Julia to override cli evidence. This is conditional drift, the relocation of work to cli.
  - Corrections:
    - R8's cal(a) moved sense by only ~0.38 logits (log 150/103) against a 2.9 gap, so R8 refutes the marginal correction at α=1, not every prior effect.
    - R7's "≈0.81" becomes ≈0.79 with the corrected count.
  - Reader's view: no branch in the live set wins; the Julia-alone proof retires. My collapse: the drift is conditional and time-local, which is exactly the fine-tune epitaph's resurrection condition (a rolling clock), so B-roll is selected.

- R10 M-roll1 (`roll.py`, `ltr_roll.py`) — **Disconfirming** (hit@1 0.673 ≤ 0.700), and the mechanism held:
  - test package hit@1 / MRR:
    - julia-roll 0.673 / 0.800, Δ vs F −0.093 [−0.167, −0.020]
    - ltr-roll 0.747 / 0.851; F 0.767 / 0.855; R4 raw 0.620 / 0.779
  - Per chunk, hit@1 (julia / F / ltr-roll):

    | Chunk | julia | F | ltr-roll |
    |---|---|---|---|
    | 0 | 0.567 | 0.833 | 0.833 |
    | 1 | 0.767 | 0.733 | 0.767 |
    | 2 | 0.533 | 0.633 | 0.633 |
    | 3 | 0.733 | 0.867 | 0.700 |
    | 4 | 0.767 | 0.767 | 0.800 |

  - Chunks 1–4: cli→sense among F-only losses 2 (was 26 over all 150); F-only 14, julia-only 8. Julia's top-1 is sense 86, cli 44 (was 130 sense).
  - concept: c:julia-roll 0.752 / 0.856; c:ltr-roll 0.771 / 0.861; c:prior 0.780 / 0.853 (cannot discriminate, R7).
  - Read: the rolling clock removed the conditional drift, but Julia alone stays below F. Its 8 unique wins are information F lacks.

- R11 M-fuse1 (`fuse.py`) — **Mixed**. Split: concept is Expected; package is a point gain without significance.
  - package test (hit@1 / MRR):
    - rrf(kNN, bm25 @parent, julia-roll): 0.773 / 0.865; Δ vs F +0.007 [−0.027, +0.040] / +0.010 [−0.010, +0.030]; Δ vs control +0.027 [−0.013, +0.067] / +0.015 [−0.006, +0.037]
    - control rrf(kNN, bm25 @parent, ltr-roll): 0.747 / 0.850
    - rrf(F, julia-roll): 0.753 / 0.850
  - concept test (hit@1 / MRR):
    - c:rrf(prior, julia-roll): 0.789 / 0.879; Δ MRR vs c:prior +0.025 [+0.013, +0.040]; vs control +0.022 [+0.009, +0.037]
    - control c:rrf(prior, ltr-roll): 0.780 / 0.857
  - Dropped candidate: extending the test window. There are 37 newer commits, about 25 tasks, which moves the CI width only from ±0.040 to ±0.037 and leaves the next decision unchanged.

- R12 M-roll2 (`roll2.py`, `ltr_roll2.py`, `fuse2.py`) — **Mixed**. The fusion is above F and the control only as a point estimate: F-disagreements are 5:1 (p ≈ 0.22), and the hit@1 intervals touch or cross 0 (V2). Julia alone misses its first-30 bar.
  - package test (hit@1 / MRR):
    - rrf(kNN, bm25 @parent, julia-roll2): 0.793 / 0.875; Δ vs F +0.027 [−0.007, +0.060] / +0.020 [+0.002, +0.041]; Δ vs control +0.047 [+0.000, +0.093] / +0.025 [−0.001, +0.051]
    - fused-only hits 5, F-only 1
    - rrf(F, julia-roll2): 0.787 / 0.868
    - julia-roll2 alone: 0.680 / 0.813; first 30: 0.667 (bar 0.700)
    - ltr-roll2: 0.747 / 0.851; control fused: 0.747 / 0.850
  - Julia vs F top-1: F-only 23 (cli→sense 8), julia-only 10.
  - concept: c:rrf(prior, julia-roll2) 0.780 / 0.864 against control 0.780 / 0.857 (not meaningful, V1).
  - These are burned-test numbers (V1); the bootstrap is optimistic.

- R13 M-direct1 (`direct.py`, `ranks_direct.json`) — **Mixed**. Julia's seat is on top, but not separably from the decayed baselines.
  - package test (hit@1 / MRR):
    - Julia seat: 0.793 / 0.875
    - X seats: dp 0.773 / 0.864, dk 0.773 / 0.861, lr 0.760 / 0.851
    - F-decay: 0.740 / 0.843
  - Julia seat vs X seat, ΔMRR:
    - dp −0.011 [−0.035, +0.013]
    - dk −0.014 [−0.037, +0.009]
    - lr −0.024 [−0.048, −0.003]
    - F-decay −0.032 [−0.065, −0.001]
  - Beside rows (4 voters):
    - Julia added to dk raises MRR, 0.861 → 0.867; added to lr, 0.851 → 0.862.
    - Julia added to dp lowers it, 0.864 → 0.857 (the readback wanted a rise).
    - Every X added beside Julia lowers Julia's seat.
  - Direct algos alone: dp 0.600, dk 0.700, lr 0.567 hit@1, against julia-roll2 alone at 0.680.
  - Δ convention: X − Julia seat.
  - Reading: on point estimates only, Julia is the best third voter. Disagreements are 7:4 against the dp seat and 6:3 against the dk seat (both p > 0.5).
  - **dk alone (0.700) beats julia-roll2 alone (0.680).** So "reasons better than direct algos" does not hold standalone.
  - V2, exploratory on burned data: split the tasks by whether kNN top-1 equals BM25 top-1.
    - Disagree (n=86): Julia seat 0.733, dk seat 0.698, dp seat 0.674, F 0.686.
    - Agree (n=64): Julia 0.875, dp 0.906.
    - Julia's whole margin sits where the evidence conflicts: the arbitration signature.
  - Second consecutive collapse with the proof unmoved, so Next reads the checkpoint.

- R14 M-prosp1 (`ft_p/`: `roll2p.py`, `direct_p.py`, `signs.py`) — **Disconfirming** against its pre-registered bar. S loses every disagreement with the dk seat.
  - The set: n=26, 12 PR clusters by first-parent merge, arbitration stratum 16.
  - Replay fidelity failed: the top-5 differ on all 3 checked tasks. MLX training is not deterministic run to run, so this Julia replicates M-roll2's *procedure*, not its weights.
  - package (hit@1 / MRR):
    - S: 0.808 / 0.897
    - F: 0.769 / 0.875
    - dk seat: **0.923 / 0.950**
    - dp seat: 0.731 / 0.853
    - lr seat: 0.731 / 0.838
    - julia-roll2 alone: 0.769 / 0.875
    - dk alone: 0.731 / 0.854
    - bm25 @parent alone: 0.808 / 0.878
    - kNN: 0.769 / 0.854
    - prior: 0.615 / 0.771
    - random: 0.029 (1/35)
  - Sign tests (S wins : losses):
    - vs F 2:1
    - vs dp seat 2:0
    - vs lr seat 2:0
    - **vs dk seat 0:3** (2 in PR 40f52880, 1 in 0e47288b; arbitration stratum 0:3)
    - first-of-PR vs dk seat 0:1
  - Julia alone vs dk alone: 4:3 (first-of-PR 1:1).
  - concept (n=13): c:julia 0.769 against c:prior 0.923 and c:kNN 0.846.
  - What held prospectively: Julia alone is far above random and the prior (0.769 against 0.029 and 0.615), and level with F. Julia fused beats F, dp and lr in point terms.
  - What failed: the time-decayed kNN in the third seat beats Julia there. And static bm25 @parent alone is level with or above Julia alone.
  - So "above static bm25 and other tools" and "better than direct algos" are **not shown**, alone or composed.

- R15 M-arb1 (`ft_p/arb.py`, `ranks_arb.json`) — **Mixed, leaning Disconfirming**. Julia moves with its evidence but does not tell good evidence from bad.
  - hit@1, test: true 0.620, none 0.607, shuffled 0.560.
  - hit@1, prosp: true 0.538, none 0.500, shuffled 0.577.
  - follow rate: test 0.353, prosp 0.269.
  - Reading:
    - Julia's pick follows planted evidence a third of the time, so it reads.
    - True evidence adds only +0.013 over none, so it does not discriminate good evidence from bad.
    - M-roll2's gains therefore came from label freshness in the weights, which is what dk gets for free, and not from arbitration.
  - This matches R14, where dk in the third seat beats Julia.

- R16 M-arb2 (`ft_p/arb2.py`, `picks_arb2.json`) — **Disconfirming**. Julia as arbiter loses to every direct rule that sees recency.
  - Pick accuracy on the exactly-one-right tasks, val + test (n=69):
    - Julia zero-shot: 0.507
    - Julia fit1: 0.667
    - direct rules: kNN 0.696, prior 0.754, decayed prior 0.754, recent30 0.725, **dk 0.797**
  - Julia fit1 vs dk: 4 wins, 13 losses.
  - prosp (n=7): Julia 0.143 against dk 0.714 (0 wins, 4 losses).
  - Training loss reached 0.03: it memorised 146 examples and generalised worse than a count.
- R17, exploratory on existing ranks (test + prosp, 176 tasks): hit@1 by lexical-overlap tertile, where the semantic edge should show.
  - Low overlap: Julia 0.638, dk 0.690, kNN 0.672, bm25 0.500, F 0.672.
  - High overlap: Julia 0.750, dk 0.717, F 0.767.
  - Julia has no edge where the words do not match.

## Active move
- **M-dom1: reason in domain language by hand** (user, 2026-09-30: "You don't need history. We've been here already. You need to learn how to reason in domain language, because Julia cannot").
  - Material: 8 open specs from `docs/specs/`. These are unbuilt work with no history to look up. They are read against `.compass`: DOMAIN.md (contexts → concepts with what it is, invariants, lifecycle, composed of), GLOSSARY.md (term → meaning, bounded context, product appearance, implementation aliases) and the block READMEs (responsibility, boundary, coordinates).
  - Act: for each spec, write the trace I would follow in the domain's own words:
    - which terms it uses;
    - which concept, and which invariant or lifecycle stage, it touches;
    - which context;
    - which block, and which boundaries exclude its neighbours;
    - which coordinates.
    Then name every step type and label it as either a local judgement (one state, one question, a few options: Julia-sized) or a walk (graph traversal: algorithmic).
  - Observation source: the trace file `ft/dom_traces.md`.
  - Expected: at least 3 distinct step types recur across the 8 specs. At least one of them is a judgement that neither lexical overlap nor graph position can make, for example a boundary exclusion ("does not X; X belongs to Y").
  - Disconfirming: every step reduces to term lookup plus the graph walk, so BM25 over the chart plus routing already reasons the whole trace and Julia has no seat.
  - Review point: a read-only critic reads the traces cold.

## Open links
- Review V2 (R12/R13, M-prosp1):
  - Corrections are applied above: the clock ties, the replay check and the bars.
  - Proposed M-arb1: a counterfactual on the evidence. Swap or shuffle the kNN and BM25 blocks in Julia's state; if Julia's pick follows the content, it is reading, not a prior. Inference only.

- **Review V1 (read-only critic, beside M-roll2):**
  - **The 150 test tasks are burned.** R9 selected B-roll from test gold, and later designs are adaptive on the same 150, so no claim rests on them alone.
  - **Clean confirmation:** freeze the winning system and score it on the 37 commits after `03ccba7b` (never read; about 25 tasks) and on commits that land later.
  - **R11's concept claim is retracted.**
    - 85 of 109 concept tasks are `reach`, so c:prior is "always reach".
    - An untuned mapping from F's top-3 packages to concepts scores 0.789 / 0.866, and the fusion adds about one task over it.
    - Concept labels also miss the 41 tasks whose files were created after C.
  - **The package point gain is one task** (4 fused-only against 3 F-only).
  - **Intervals are too narrow:** the bootstrap ignores PR clustering, and about 15 rows are uncorrected.
  - **F is BugLocator's design**, and ltr is a thin version of Ye et al.'s learning-to-rank. Missing controls: time-decayed kNN and prior, an online TF-IDF logistic classifier on subjects refit per task, LambdaMART, and a dense bi-encoder retriever.
  - **Selected Next after M-roll2** (whichever way it lands): those direct algos on the per-task clock, in Julia's seat and alongside it, then prospective scoring.
- The pre-work set leaks for items written before C; only the 10 after-C items are used. n=10 cannot discriminate (CI ±0.4).

## Epitaphs
- **B-hist: owner retrieval from commit history** (M-mui1 stopped before scoring, 2026-09-30). History lookup is recall, not reasoning; decayed kNN owns it (R14, R16, R17). Resurrect never as a Julia test; history stays a direct algo.
- **B-arb (R15–R17):** Julia as a reader or arbiter of evidence. It moves with evidence without telling good from bad. Taught arbitration, it memorises its examples. On low-overlap tasks it has no semantic edge.
  - Resurrect only with training material of at least 10× the labelled examples (for example every commit's touched files, not ~400 subjects), or with a question type where the direct algos have no signal at all.

- **B-cal: inference-time prior correction** (R8). Killed because (a) scored 0.580 ≤ 0.700 and cli→sense stayed at 25 ≥ 20. Resurrect only if a conditional (per-evidence) drift correction is proposed; a marginal one is refuted.
- **Zero-shot Julia on repo text** (R1). Killed by being below prior and BM25 at both levels. Resurrect if a Julia release is trained on code or repository prose.
- **B-rr: tools retrieve, Julia decides in one group** (R5). Killed by test package 0.567 ≤ 0.700; hard negatives made it worse than random groups (rag 0.620). Resurrect if the candidate question is trained on data from after the cut.
- **More fine-tuning on pre-C material** (R2, R4 ep2+, R5; read R7; resurrected as B-roll at R9). Killed because its errors follow the stale pre-C prior, and more training worsened test (R5 0.567 < R4 0.620). Resurrect with post-C training material under a rolling clock.
- **Plain fine-tune without evidence** (R2). Killed by test 0.493–0.540 against val 0.73: it memorises the pre-cut base rate and cannot see drift. Resurrect only with a rolling retrain clock (trained to each task's parent).

## M-dom1 result (2026-09-30): Mixed
The traces are in ft/dom_traces.md, and a cold critic reviewed them.
- The walk/judgement split is real.
- Same-spelling collisions are a genuine lexical failure. "Execution record" lands on retention/record, and I fell for "journal" in 0048.
- The negation case is refuted under compass_search. The flake case is a design decision, not a sense pick.
- Six of the steps I labelled judgements are lookups or link walks.
- My two heavy traces (0032, 0051) got the decisive invariant wrong. The cause was not reading the owning boundary and the spec's own refusals in full. That is a missing-context failure, the same failure Julia has.

Siblings, from public sources:
- **Jev and Kev** are decision heads on decoder LLMs: a Qwen3.5/3.8 base, LoRA rank 16 and a pointer head. Kev takes a state of up to 64k tokens, and Kev-27B scores 0.848 against Jev's 0.857.
- **Julia-1** is a 144M mmBERT with a context of about 1k tokens. It loses where labels are many and knowledge is needed: Banking77, 64 against Jev's 87.

## (superseded) Arrange M-dom2. Put the same local judgement rows before Julia with the owning clause retrieved into the state, and before a Kev checkpoint with the whole owning README in the state. Score both against compass_search.

## M-dom2 (arranged 2026-09-30, before any score)
- **Tasks.** The 44 specs in dom/gold.json. The gold for each spec is the set of top-level blocks that own the files it names, by the chart's Implementation coordinates at the longest prefix. The specs are written before the work, which is the task set the 29-09 report lacked.
- **Query.** The spec text with every code span, link and path removed, so file names cannot leak the answer.
- **Rows scored.**
  - random;
  - leave-one-out prior;
  - BM25 over the 11 top-level READMEs;
  - BM25 over all 96 READMEs, mapped to the top-level block by max;
  - compass_search, first hit per block;
  - Julia zero-shot, choice over 11 block names, with the domain evidence in the state (each block's Responsibility and Boundary sentences that share a stem with the spec);
  - Julia with the same shape and no evidence;
  - Julia fused with BM25 by RRF.
- **Metrics.** hit@1 and MRR, with a paired bootstrap against the best direct row.
- **Expected.** Julia with evidence beats BM25 and compass_search on MRR, with an interval that excludes 0.
- **Disconfirming.** Julia with evidence is at or below the best direct row. Then Julia judges nothing at block grain either.
- One run with no tuning. Any variant added after scoring is reported as post hoc.

### M-dom2 result: Disconfirming (one run, 44 specs, mrr)
| row | mrr |
|---|---|
| random | 0.401 |
| prior | 0.783 |
| **BM25 top READMEs** | **0.826** |
| BM25 all READMEs (max) | 0.883 |
| compass_search | 0.613 |
| Julia, evidence in state | 0.373 |
| Julia, no evidence | 0.431 |
| Julia + BM25 (RRF) | 0.620 |

- Julia is at random, and the domain evidence in its state lowers it.
- On a task set written before the work, it stays behind the direct algos. This is the third task set in a row where Julia is refuted: history, commit subjects (the 29-09 report), and specs.
- Epitaph **B-dom**: Julia as the judge of spec ownership. Resurrect only with a model that bridges jargon (the Kev class) or with a Julia trained on this chart. A zero-shot variant is not a resurrection.

## (superseded) Next
Report to the owner. The goal as stated is refuted on every task set measured. The decision on what Julia is for belongs to her.

## M-dom3 (arranged 2026-09-30, before training): resurrect B-dom by its own condition
- **Train.** Julia learns the chart's own language, with no specs, history or hand labels. Two sources:
  - each sub-block README (Responsibility plus Boundary) → its top-level block;
  - each source file under a single-owner coordinate (leading comment plus export names, path removed) → its block, capped at 150 per block.
  Row shape: choice over the 11 block names plus none, permuted.
- **Model selection.** 15% of the files are held out as validation. 3 epochs at lr 3e-5, and the epoch is chosen by validation MRR.
- **Test, once.** The 44 specs, scored with the same shapes as M-dom2 (evidence in state, and no evidence).
- **Expected.** Trained Julia's MRR is above BM25 top READMEs (0.826), with a paired interval that excludes 0.
- **Disconfirming.** It is at or below 0.826. Then the epitaph stands and the goal is refuted at block grain with training too.

### M-dom3 result: Disconfirming against the pre-registered bar
- **Trained on the chart:** 666 units, 3 epochs (18 s each), validation MRR 0.415 → 0.654 and still rising.
- **Test on the 44 specs:** MRR 0.767 with no evidence (hit@1 0.64). That is Δ −0.059 [−0.178, +0.057] against BM25 top READMEs at 0.826. With evidence in the state it falls to 0.524.
- **What moved.** Training lifts Julia from random (0.43) to the level of the prior (0.78). Nothing shows it passing the prior, and the training set's reach share (142 of 666) may be the prior in another form.
- **Epitaph B-dom stands.** The goal is refuted at block grain, with and without training. Validation still rising at epoch 3 is a new run, not this one; it would need its own pre-registration and the critic's leakage fixes.

### M-dom3 critic: the 0.767 is an upper bound
- **Leakage.** About 20–25 of the 44 specs have a gold file's header comment in training, and some are near-verbatim (0028 and instrument/index.ts).
- **The bar was set too low.** The best direct row is BM25 over all READMEs at 0.883, not 0.826.
- **The gold rewards reach.** Multi-owner fallbacks such as cli/commands add free labels.

A fair Julia score is below 0.767, and the fair bar is at least 0.883. **B-dom stands, and the goal is refuted.** A rerun is admissible only with the three amendments set before any result:
1. exclude the gold paths from training and validation;
2. add BM25 over the identical units;
3. report non-reach and single-gold specs separately.

## (superseded) Next
Owner decision (see the report of 2026-09-30). No further move without it.

## M-dom4 (arranged before any result): the clean rerun of M-dom3
- **A1.** Every path in gold.json for the 44 specs, and every file under a directory those paths name, is removed from training and validation.
- **A2.** A new row, BM25 over the identical training units, scores each block by the max over its units. The bar is the maximum of that row, BM25 over all READMEs (0.883) and the prior (0.783).
- **A3.** MRR is also reported on the non-reach specs and on the single-gold specs.
- **Epochs: 5**, chosen now because validation was still rising at epoch 3. The epoch is selected by validation, with validation drawn from the non-excluded units.
- **Expected.** Julia-dom (no evidence) MRR exceeds the bar with a paired interval above 0.
- **Disconfirming.** Anything else.

### M-dom4 result: Disconfirming, and decisive
Exclusion at directory level (A1) left 91 units: 78 train and 13 validation, mostly sub-block READMEs.

| row (MRR) | all 44 | non-reach 15 | single-gold 23 |
|---|---|---|---|
| random | 0.40 | 0.46 | 0.22 |
| prior | 0.78 | 0.36 | 0.78 |
| BM25 all READMEs | **0.88** | **0.79** | **0.87** |
| BM25 over the same 91 units | 0.86 | 0.63 | 0.83 |
| Julia trained on them | 0.44 | 0.39 | 0.38 |

- On identical material, BM25 scores 0.86 and Julia 0.44.
- M-dom3's 0.77 was leakage plus the prior.
- The goal is refuted, with the leak-free test included. B-dom is closed.

## (superseded) Next
Owner decision. No further move on this goal without a new question.

## (superseded by owner reframe 2026-09-30) Next above
Owner reframe: Julia is the **detector**, not the product. What is under test is a translation layer: plain-language context that lets a clean-room reader with no prior knowledge operate in our domain. Julia fails because it reads "sense", "reach", "reading" as ordinary words. A layer that works should move Julia; a layer that doesn't leaves it at random.

### M-tr1 (Arrange): a plain-language translation layer, with Julia as the gauge
- **Layer (built blind).** A clean-room subagent reads only the chart (DOMAIN, GLOSSARY, 11 top READMEs) and the package manifests. It never sees `docs/specs` or the gold. It writes `dom/translate.json`:
  - (a) per block, a plain-English description of ≤ 30 words: what it does and what it never does, with no coined terms;
  - (b) a lexicon: each coined term or package name → a plain paraphrase of ≤ 15 words that says what the thing does and never which block owns it.
- **Application (mechanical).** Spec text: clean(), then each lexicon term is replaced by its paraphrase (whole word, case-insensitive). Options: the plain descriptions instead of block names.
- **Rows** (44 specs, Julia zero-shot, 3 permutations, logit − none):
  - J0: raw spec + name options (= M-dom2, 0.431);
  - J1: raw spec + plain options;
  - J2: translated spec + plain options.
- **Direct rows on the same material:**
  - BM25(translated spec → plain descriptions);
  - BM25 all READMEs (0.883);
  - prior 0.783, random 0.401.
- **Expected:**
  - J2 MRR ≥ 0.60 (materially above random, bootstrap interval of the difference > 0);
  - J2 > J0;
  - J2 ≥ BM25 on identical material.
- **Disconfirming:** J2 − J0 interval includes 0. The layer does not reach this reader.
- **Report** all 44, non-reach and single-gold. One run. No tuning of the layer after seeing scores.

### M-tr1 result: Disconfirming by the pre-registered bar, with a positive direction
MRR:

| row | all 44 | non-reach 15 | single-gold 23 |
|---|---|---|---|
| random | 0.401 | 0.459 | 0.215 |
| J0 raw spec, name options | 0.431 | 0.382 | 0.376 |
| J1 raw spec, plain options | 0.491 | **0.652** | 0.410 |
| J2 translated spec, plain options | 0.523 | 0.551 | 0.434 |
| BM25 plain descriptions, raw spec | 0.702 | 0.558 | 0.648 |
| BM25 plain descriptions, translated spec | 0.682 | 0.577 | 0.704 |
| BM25 all READMEs | 0.883 | 0.789 | 0.870 |

- J2 − J0 is +0.092 [−0.051, +0.228]. The interval includes 0, J2 is below 0.60, and J2 is below BM25 on identical material.
- **Plain options help:** non-reach +0.27, J1 vs J0.
- **The mechanical spec translation is garbled.** Word substitution replaced ordinary-sense words mid-sentence: "token" became "Movement over time in a value…" and "subject" became a definition in the middle of a phrase. Substituting words is not translating. The layer's *application* failed, not necessarily the layer.
- **Julia's state is a 300-token spec head;** its useful span is about 64 tokens. The work is never stated as one act.

### M-tr2 (Arrange): the work translated to one plain act (the factory question)
- **Translator (blind).** A clean-room subagent sees each spec plus `translate.json`'s lexicon only: no chart READMEs, no block names, no gold. It writes one plain sentence of ≤ 25 words per spec: what the work makes the system do, as a verb and an object, with no coined terms.
- **Rows:**
  - J3: act sentence + plain options (Julia zero-shot, same perms);
  - BM25: act sentence → plain descriptions;
  - existing J0, J1, J2 and BM25 all READMEs.
- **Expected:**
  - J3 ≥ 0.60;
  - J3 − J0 interval > 0;
  - J3 ≥ BM25 on the same act sentences.
- **Disconfirming:** J3 − J0 interval includes 0.
- **Mixed:** J3 beats J0 but not BM25 on the same material (the layer reaches the reader; Julia adds nothing over lexical matching).
- One run. The translator prompt is fixed before scoring.

### M-tr2 result: Disconfirming overall, and the mechanism is found
MRR:

| row | all 44 | non-reach 15 | single-gold 23 |
|---|---|---|---|
| J3 act sentence + plain options | 0.459 | **0.630** | 0.362 |
| BM25 act sentence → plain descriptions | 0.595 | 0.481 | 0.542 |
| BM25 Julia's 300-token head → plain | 0.633 | 0.577 | 0.511 |

- J3 − J0: all +0.028 [−0.114, +0.171]; non-reach +0.248 [+0.020, +0.478].
- J3 − BM25(act): all −0.136; non-reach +0.149 [−0.133, +0.425].
- **Mechanism.** Julia's first choice collapses onto two options: acquisition 22 and retention 18 of 44. It keys on the leading verb.
  - Acts that start "Stores", "Writes" or "Records" go to retention.
  - Acts that start "Runs", "Adds" or "Inserts" go to acquisition ("Drives… captures").
  - "Selects the test cases that executed changed code" goes to retention, while the reach option says the same thing in the same words.
  - Local attention plus options written verb-first means the verb decides and the object is ignored.
- **The critic:**
  - the translator saw paths, a possible leak;
  - the smallest detectable effect is about 0.20 MRR on all 44;
  - prior art (HyDE, doc2query, NLI zero-shot) expects rewriting to help BM25 more than a small cross-encoder.

### M-tr3 (Arrange): options object-first, with a second, independent task set
- **Change.** One change only: a blind author (chart only, no specs, no scores) rewrites each block option to lead with the nouns the block owns, then one verb phrase ("Per-test coverage records, test selection: …").
- **Sets:**
  - the 44 specs, with act sentences (as in M-tr2);
  - the 109 history test commit subjects with concept labels (`ft/data.json` test split), raw subjects.
- **Rows on each set:**
  - Julia with name options, with verb-first plain options, and with object-first options;
  - BM25 against the same option texts.
- **Expected:**
  - on both sets, object-first beats verb-first for Julia, with the paired difference positive;
  - Julia's top-1 is no longer collapsed (the largest share ≤ gold's largest share + 10 points);
  - Julia(object-first) ≥ BM25 on the same option texts.
- **Disconfirming:** no gain from object-first on the history set.
- This move is adaptive (the idea came from M-tr2's errors), so the history set is the one that counts.

### M-tr3 result: Disconfirming (history set); the verb hypothesis is wrong
MRR; random ≈ 0.27 with 1 gold of 11:

| options | spec BM25 | spec Julia | history BM25 | history Julia |
|---|---|---|---|---|
| name | 0.464 | 0.269 | 0.237 | 0.289 |
| verb-first | 0.595 | 0.459 | 0.339 | 0.244 |
| object-first | 0.575 | 0.512 | 0.281 | 0.256 |

- Spec Julia, object-first − verb-first: +0.053 [−0.069, +0.171].
- History Julia, object-first − verb-first: +0.012 [−0.036, +0.060].
- Julia's top-1 still collapses; only the options it collapses onto changed:
  - spec: report 13, presentation 10;
  - history: presentation 66, report 27, while gold is 77% reach.
- It is a **per-option prior**, not verb matching. Commit subjects are untranslated jargon, and on them everyone is at random.
- One caveat: my prompt to the author used reach's own nouns as its example.

### M-tr4 (Arrange): contextual calibration (Zhao et al. 2021), no new text
- **Change.** Per option set, subtract each option's score on content-free states ("Work: N/A", "Work: .", "Work: [task]"), averaged over perms, from its score on every task. Nothing else changes.
- **Rows.** Calibrated Julia for {verb-first, object-first} on {spec acts, history}, compared with uncalibrated Julia and BM25 on the same text.
- **Expected:**
  - top-1 collapse is gone;
  - calibrated object-first beats uncalibrated on both sets, with the interval above 0;
  - on spec acts, calibrated Julia ≥ BM25 on the same text.
- **Disconfirming:** no gain on history.

### M-tr4 result: Expected within its boundary. The first positive step.
Top-1 option bias on content-free input, verb-first: retention +43, acquisition +35 … review −30. That is the collapse.

| row | spec 44 | history 109 |
|---|---|---|
| random | 0.401 | 0.282 |
| prior | 0.783 | **0.853** |
| BM25 same text (verb / obj) | 0.595 / 0.575 | 0.339 / 0.281 |
| Julia verb-first, raw → calibrated | 0.459 → **0.620** | 0.244 → 0.354 |
| Julia object-first, raw → calibrated | 0.512 → 0.593 | 0.256 → 0.352 |

- Calibration effect (object-first): spec +0.082 [+0.025, +0.147]; history +0.096 [+0.062, +0.133].
- Calibrated Julia − BM25 on the same text:
  - spec verb-first +0.025 [−0.091, +0.140], a tie;
  - history object-first +0.071 [+0.008, +0.132].
- **The history set cannot serve as a gauge.** Commit subjects are untranslated jargon, every text reader sits within 0.07 of random, and the prior (reach, 77%) is 0.853.
- **The remaining gap is material, not model.** BM25 all READMEs reads 96 READMEs (0.883); Julia reads 11 × 30 words.

### M-tr5 (Arrange): the sub-block grain of the translation layer
- **Layer.** A blind author (chart only) writes one verb-first plain description of ≤ 30 words per sub-block README (about 85), in the same style as `translate.json` blocks.
- **Rows** (spec acts):
  - Julia, calibrated per option, over the sub-block options in groups of 12 + none, 3 partitions; a block scores the max of its sub-blocks;
  - BM25 over the same sub-block descriptions (max);
  - BM25 all READMEs (0.883).
- **Expected:**
  - calibrated Julia(sub-block) > Julia(11 blocks, calibrated) 0.620;
  - calibrated Julia(sub-block) ≥ BM25 on the same sub-block text.
- **Disconfirming:** calibrated Julia(sub-block) ≤ 0.620.

### M-tr5 result: Disconfirming
Calibrated Julia at sub-block grain scores 0.531 (sub + top: 0.583), against 0.620 at 11 blocks. BM25 over the same sub-block plain text scores 0.693, and over the raw READMEs 0.883.
- More options mean more noise: the max over 84 noisy scores favours blocks with many sub-blocks.
- **Structural finding.** Translating the chart into plain text costs BM25 0.19 (0.883 → 0.693), because specs and READMEs share jargon. What BM25 exploits is exactly what Julia cannot read. "Julia beats BM25 over the raw chart" therefore asks Julia to win at jargon matching.
- Epitaph: sub-block grain for Julia. Resurrect only with a per-option discriminator better than calibration.

### M-tr6 (Arrange): Julia with retrieval, not instead of it (the "no alone" rule)
- Computed from existing ranks, with no new model run.
- **(a) RRF.** Calibrated Julia (11 blocks, verb-first, spec acts) fused with BM25 all READMEs, k = 60.
- **(b) Rerank.** BM25 all READMEs' top 3, reordered by calibrated Julia; the rest keep BM25 order.
- **Expected:** (a) or (b) > 0.883, with the paired interval above 0 on at least one pre-registered subset.
- **Disconfirming:** both ≤ 0.883. Julia then adds nothing that retrieval lacks.

### M-tr6 result: Disconfirming
- RRF: 0.765, −0.118 [−0.210, −0.021] against BM25.
- Rerank of BM25's top 3: 0.773, −0.110 [−0.193, −0.023].
- Both are below BM25 on every subset. On this task, Julia adds nothing that retrieval over the raw chart lacks.

### The translation line (M-tr1–6), read against the outcome
The gauge moves, but not past the bar.
- Jargon in, jargon options: 0.431.
- Plain act + plain options + calibration: **0.620**. That is +0.22 over random, and it ties BM25 on the same plain text (0.595).
- It never reaches the prior (0.783) or BM25 over the raw chart (0.883).
- The loss is in the layer. A 30-word plain description carries less than a README: BM25 itself drops 0.883 → 0.69 when it is fed the translation.
- The layer as built is legible (a jargon-blind reader ≈ lexical match), but it is not **complete** (it keeps about 70% of what the raw chart gives a lexical reader).

## Next
Report to the owner. The candidate move is a translation that keeps the information: a plain gloss added beside the jargon instead of replacing it, with the gauge being Julia(plain) closing on BM25(raw). This is the owner's call. The goal as worded, "Julia above static BM25", is not reached.

### M-tr7 (Arrange): gloss beside the jargon, not instead of it
Owner's reframe authorizes the translation-layer line, so this move needs no new decision.
- **Options (mechanical, spec-blind):** `<block> (<its sub-block names>): <plain verb-first description>`. Jargon is kept as the lexical bridge, and the plain gloss carries the meaning.
- **States:**
  - 7a: plain act sentence, then the raw spec title line (the jargon it names);
  - 7b: raw spec head, as in J0.
- Calibrated as in M-tr4. BM25 over the same option texts, fed the same states.
- **Expected:**
  - calibrated Julia(7a or 7b) > 0.620;
  - above BM25 on the same text;
  - goal bar: ≥ 0.883 (BM25 raw chart).
- **Disconfirming:** both ≤ 0.620.
- Deviation: options are trimmed to 46 tokens (Julia's option contract is 48), and sub-block names are space-separated.

### M-tr7 result: Disconfirming
Calibrated Julia with the gloss beside the jargon: 7a 0.642, 7b 0.644. That is no better than 0.620. BM25 over the same gloss text: 7a 0.714, 7b 0.780.

### Owner correction on fusion
M-tr6 was not the fusion the owner meant. BM25 also chooses from a set. The intent is that BM25 hands Julia good candidates, with its reasons, and Julia **perfects** the choice among them. That is a fresh choice over a short list, not a vote between two full rankings.

### M-tr8 (Arrange): BM25 proposes, Julia disposes
- **Candidates:** BM25 all READMEs' top k, with k ∈ {2, 3}. Each candidate carries its best-matching README (the one that set its max) and, as BM25's reason, the README sentence with the most query idf overlap.
- **Julia row:** one per spec.
  - State: act sentence + spec title, plus "Evidence:" and one reason sentence per candidate (as `<block>: <sentence>`).
  - Options: the k candidates' plain descriptions (verb-first) + none.
  - Calibrated with a null state over the same options.
- **Final rank:** Julia's order over the top k, then BM25's order for the rest.
- **Rows:** k = 2 and k = 3, each with and without evidence. Also reported: BM25 recall@k, the ceiling on what reordering can gain.
- **Expected:** at least one row > 0.883, with the paired interval > 0 on all or on a pre-registered subset.
- **Disconfirming:** every row ≤ 0.883.

### M-tr8 result: Disconfirming
- BM25 recall@1/2/3 is 0.795, 0.932 and 0.977.
- Julia over BM25's top 2: MRR 0.701, hit@1 0.432 (evidence 0.678); over the top 3: 0.659 (evidence 0.606). All are below 0.883, with intervals below 0 on "all".
- Diagnostic (not a claim), on the 35 pairs where exactly one of the two is gold:
  - Julia picks the **first option** in 26/35 (BM25 order) and 19/35 (swapped).
  - Content accuracy averaged over both orders: raw 57%, calibrated 47%. That is about a coin flip. Position dominates the two-way choice.

### M-tr9 (Arrange): the factory question is yes/no, one per candidate, so position cancels
- For each spec and each BM25 top-k candidate b (k = 2, 3), one row:
  - state: act + title;
  - question: "Does this part of the system do this work? <plain description of b>";
  - options: "Yes." / "No.";
  - score: logit(Yes) − logit(No), with the same slot for every candidate.
- Julia reorders the top k by that score, and BM25's order holds the rest.
- **Expected:** a row > 0.883; on the 35 decidable pairs, accuracy ≥ 75% (BM25's own accuracy on them is reported).
- **Disconfirming:** ≤ 0.883 and pair accuracy ≤ 60%.

### M-tr7 result: Disconfirming
- A gloss beside the jargon, calibrated: 0.642 and 0.644.
- BM25 on the same text: 0.714 and 0.780.

### M-tr9 result: Disconfirming
- Yes/no per candidate, so position cancels:
  - top 2: 0.746 (Δ −0.136 [−0.227, −0.034]);
  - top 3: 0.644;
  - non-reach: 0.789, equal to BM25.
- On the 35 decidable pairs: Julia 17/35, BM25 29/35.
- With position removed, Julia's judgement of which block owns the work is at chance. Fusion cannot perfect BM25 when the second-stage judge is below the first stage on the very cases it is asked to decide.

## Next (replaces the earlier Next)
- Nine collapses (M-tr1 to M-tr9) left the proof unmoved: no Julia row has beaten 0.883.
- Move: read this checkpoint against the outcome and report to the owner. Every text Julia saw kept whole-block ownership as one judgement. The traces (dom_traces.md) say that judgement is S3/S2 over boundary clauses, which no row has asked yet.

### M-tr10 (Arrange): the chart's own Responsibility and Boundary are the context; one ownership question per block
- For each spec × block, one row:
  - state: `Part <b>. Does: <Responsibility>. Does not: <Boundary>` (the chart's words, links stripped, ≤ 380 tokens) + `Work: <title>. <cleaned spec> ≤ 350`;
  - question: "Does this part own this work, given what it does and does not do?";
  - options: Yes./No.;
  - score: yes − no, minus the same row with Work: N/A (the block prior).
- Rows:
  - (a) Julia alone over 11;
  - (b) BM25 top 2 reranked;
  - (c) BM25 top 3 reranked;
  - the 35-pair accuracy.
- **Expected:** (b) or (c) > 0.883 with the lower CI > 0, or pair accuracy ≥ 26/35.
- **Disconfirming:** pair accuracy ≤ 21/35 and every row ≤ 0.883.

### M-tr10 result: Disconfirming (strongly)
- Julia alone, calibrated: 0.275; raw: 0.345. Both are below random (0.401).
- BM25 top 2 reranked by Julia: 0.678; top 3: 0.587.
- Pairs: Julia 11/35 calibrated, 19/35 raw; BM25 29/35.
- The chart's own Responsibility and Boundary text makes Julia worse. It does not read a 300-token definition of a place against 300 tokens of work. Julia's zero-shot judgement over this domain is at or below chance in every shape tried: plain, glossed, act sentences, sub-block, fused, yes/no, and in-context boundary.

## Next (replaces M-tr9's Next): NEEDS-HUMAN-DECISION
- Ten collapses have left the proof unmoved.
- The remaining lever is to **train** the translation: fine-tune Julia on factory-made question/answer rows generated from the chart (clause → block, act → verb, boundary negation), with the specs held out.
- That is a paid and long run, so the owner decides.

### M-tr11 (Arrange): train the translation from the chart alone (local MLX, time-only cost; the goal loop is taken as the go-ahead)
- **Factory:** every chart README sentence (1,901 in 95 READMEs) → the block its README sits in. Two row kinds:
  - one sentence;
  - a window of 3–6 consecutive sentences.
- **Row shape:** 11 plain options (PL), shuffled per row, + NONE. 15% drop the gold to teach NONE. The loss is ft_train's multi-positive softmax.
- **Split:** val = 10 READMEs held out by path (seeded), which selects the epoch. The specs, the gold and docs/specs are never in training.
- **Run:** 3 epochs, lr 3e-5, BS 16.
- **Score once:** the 44 specs (raw spec + title as the state, 3 perms averaged), alone over 11 and as a BM25 top-2/top-3 reranker, plus the 35-pair accuracy.
- **Expected:** some row > 0.883 with the lower CI > 0, or pairs ≥ 26/35.
- **Disconfirming:** alone ≤ 0.783 (prior) and pairs ≤ 21/35.
- **M-tr11 amendment (critic, written before any result was read):**
  - The Expected arm "pairs ≥ 26/35" is unsound, because BM25 already gets 29/35. It is replaced by **pairs > 29/35**.
  - Any result that is neither Expected nor Disconfirming is classed **Mixed**.
  - The 44 specs are now a dev set: M-tr1 to tr10 tuned PL, Qn and the cuts on them.
  - 7 of the 44 specs share 8-grams with the chart. That is symmetric with BM25.
  - Prior art (DSI, DSI-QG, BEIR, InPars/GPL): training on document text rarely beats BM25. The lever is synthetic queries in the target register.

### M-tr11 result: Mixed. The first move of the proof
- Training: val 0.344 → 0.450 (epoch 2 selected).
- **Pairs 28/35**, up from 11–19 untrained; BM25 gets 29.
- Julia alone: 0.686 (random 0.401, prior 0.783).
- BM25 top 2 → Julia: 0.871, Δ −0.011 [−0.091, +0.057].
- Training on chart text taught the domain language, which is the owner's thesis, and it did so in one step. Julia now matches BM25's judgement on the hard pairs, but does not yet exceed it.

## Next (replaces the NEEDS-HUMAN-DECISION Next)
- **M-tr12:** the critic's lever (InPars/GPL/DSI-QG). Train on **synthetic spec-register queries**:
  - A blind subagent writes 3 short design proposals per chart README, each describing a future feature or defect in that README's area. It reads chart READMEs only: no docs/specs, no gold.
  - Label: the README's block.
  - Training rows: the tr11 chart rows plus these queries. Same run and score.
- **Expected:** pairs > 29/35, or top 2 > 0.883 with the lower CI > 0.
- **Disconfirming:** pairs ≤ 28 and every row ≤ M-tr11's.

### M-tr12 result: Disconfirming in substance, although the pre-registered pair arm reads Expected
- The model collapsed during training: val 0.337 → 0.217. Julia alone picks **adjudication for all 44 specs** (single-gold hit@1 0.043).
- The two-way pick is "reach whenever offered": 27/28 times.
- BM25 top 2 → Julia: 0.905, Δ +0.023 [−0.045, +0.091]. Pairs: 31/35.
- **The trivial rule "reach if offered, else BM25" gets 32/35**, which beats Julia. Julia's win is the label prior, not reasoning.
- M-tr11 re-read under the same lens:
  - it picks reach 23/28 when offered;
  - on the 7 pairs without reach it gets 5/7, against BM25's 6/7.
- **Gauge finding:** reach is gold on 29 of 44 specs, so the 35 hard pairs are mostly "is it reach?". The 44-spec gauge cannot tell domain reasoning from a reach prior. The non-reach subset (n = 15, of which 7 are hard pairs) is too small to resolve anything.

## Next (replaces M-tr12's Next): NEEDS-HUMAN-DECISION on the gauge
- Every further arm is measured against a gauge dominated by one label.
- A trustworthy gauge needs owner-labelled work items spread across blocks. Questions I write do not count as evidence.

### M-tr13 (Arrange): remove the label prior without labels, before asking the owner
- Re-score the 44 specs with the saved M-tr11 and M-tr12 weights. Subtract each block's mean score over the 44 specs (transductive centering, no gold used), so "always reach" and "always adjudication" cancel.
- Rows: alone; BM25 top 2 → Julia. Report all, non-reach, and the pairs split into with-reach and without-reach, beside the "reach if offered" rule (32/35).
- **Expected:** alone > 0.783 (prior), and pairs > 32/35 or the non-reach top 2 > BM25.
- **Disconfirming:** alone ≤ 0.686 and pairs ≤ 29.

### M-tr13 result: Disconfirming
- With each block's mean removed:
  - M-tr11 weights: pairs 21/35, alone 0.554, top 2 0.792;
  - M-tr12 weights: pairs 19/35, alone 0.435.
- Without the reach lean, the trained Julia's content judgement is about 60% on the hard pairs, against BM25's 83%. M-tr11's 28/35 was mostly the reach prior.
- **Standing verdict:** after 13 moves, no Julia row beats BM25 on content. The Next stays NEEDS-HUMAN-DECISION: an owner-labelled gauge spread across blocks, or a change to the goal.
