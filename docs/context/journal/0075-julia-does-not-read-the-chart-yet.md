# Julia does not read the chart yet

**Date:** 2026-09-30

The question was whether a small, non-reasoning decision model can route a piece
of work to the part of the system that owns it, and do so better than lexical
search. The model was Julia-1, a 144M cross-encoder that scores a fixed list of
options against a short text. The work items were 44 specs from `docs/specs/`,
each labelled with its owning blocks in the architecture chart (`.compass/`, 11
blocks). The bar was BM25 over every chart README, which puts the owner first or
second for most specs.

It did not get there. Across thirteen pre-registered runs, Julia beat random
choice and never beat BM25 on content. A 9B decision model, Clef-flash, did
not beat it either, on owner questions or on relation questions. Every script, rank file and the run-by-run
notebook are in [the lab directory](0075-julia-does-not-read-the-chart-yet/).

## The numbers

MRR over the 44 specs. Random choice is 0.401, always answering with the most
common block is 0.783, and BM25 is 0.883.

| Run | What Julia saw | MRR |
|---|---|---|
| tr1 | the spec, block names or plain descriptions as options | 0.431–0.523 |
| tr4 | a one-sentence restatement of the spec, options calibrated on a blank input | 0.620 |
| tr7 | each option glossed with its sub-parts | 0.644 |
| tr8 | BM25's top two, Julia picks | 0.701 |
| tr10 | each block's own Responsibility and Boundary text beside the spec | 0.275 |
| tr11 | fine-tuned on the chart's own 1,901 sentences, labelled by block | 0.686 alone, 0.871 on BM25's top two |
| tr12 | tr11 plus 285 synthetic spec-shaped proposals | 0.905 on BM25's top two, see below |
| tr13 | tr11 and tr12 with each block's mean score removed | 0.554 alone, 0.792 on BM25's top two |

The run that decides a routing question is the pair: for 35 specs, exactly one
of BM25's top two blocks is a real owner. BM25 picks the right one 29 times.

- Zero-shot, Julia was at chance, 11 to 19 of 35. It picked the first option it
  was shown more often than any content could explain: 26 of 35 in BM25's order,
  19 of 35 with the pair swapped.
- Fine-tuned on the chart, Julia picked 28, then 31. Both wins were the label
  prior. `reach` owns 29 of the 44 specs, the fine-tuned models picked `reach`
  whenever it was offered, and the rule "pick `reach` if offered, else BM25's
  first" scores 32.
- With each block's mean score removed, the fine-tuned Julia picked 21 of 35:
  about 60% on content, against BM25's 83%.

## What it taught

- **Training moved it; wording did not.** Ten runs rephrased the question,
  the options and the spec into plain language, and none of them changed the
  pair count from chance. One pass over the chart's own sentences took the
  held-out chart MRR from 0.344 to 0.450 and the pair count from chance to 60%
  on content. BM25 over 30-word plain block descriptions scored 0.70 against
  0.88 over the READMEs, so plain options cost BM25 as well; how much of that
  is the jargon and how much the shorter text was never separated.
- **This gauge cannot tell reasoning from a prior.** With one block owning two
  thirds of the labels, a model that leans toward it wins the hard pairs
  without reading them. The fifteen specs `reach` does not own contain seven
  hard pairs, too few to resolve a difference. The commit-history set is no
  better: 85 of 109 items are `reach`, and it covers seven blocks.
- **Synthetic queries alone do not fix it.** Spec-shaped proposals written
  from the chart, the remedy the retrieval literature gives for training on
  document text (DSI-QG, InPars, GPL), collapsed the model onto one block.

## A larger model did not get there either

Two days later the same 44 specs went to Clef-flash, Cloudflare's 9B decision
model, run locally. It answers a choice by scoring each option's text against
the work. The query was each spec's first twelve lines, which puts BM25 at 31
of 44 first and MRR 0.831.

| Clef saw | First | MRR |
|---|---|---|
| each block's Responsibility and Boundary | 17/44 | 0.510 |
| the same, fused with BM25's rank (RRF, k = 60) | 20/44 | 0.616 |
| each block's whole README | 4/44 | 0.274 |

- **On equal text Clef read better than BM25.** BM25 over only the
  Responsibility and Boundary sections put the owner first 7 times. Its 31
  come from the rest of each README, the implementation coordinates and package
  names that specs repeat.
- **Giving Clef the rest made it worse.** With whole READMEs as options it put
  `stability` first for 39 specs. Nothing was truncated. Clef averages each
  option over its whole length, so a long option dilutes the words that tell
  blocks apart, the answers came out nearly flat, and the last option listed
  won the ties.
- **Clef on BM25's top two** picked the owner 16 times in 36, worse than a coin
  flip, at a median confidence of 0.71. Asked per boundary sentence whether it
  put the work outside a block, it was right 96 times in 202, where always
  answering "outside" is right 120 times.

A run with each README cut into short options, scored in both orders, was
stopped after 7 specs and has no result.

## Held-out batches, both models

The 44 specs were then split: 8 for development, 12 held out for scoring,
and 24 kept unseen for one pre-registered rerank test. Both models got every
block in one named state with its components, and one noul per block asked
in three phrasings and merged.

| Same specs | BM25 | Clef | Julia | Julia, chart-trained (tr11) |
|---|---|---|---|---|
| Held-out 12, MRR | 0.854 | 0.746 | 0.307 | 0.526 |
| Held-out 12, fused with BM25 (RRF) | — | 0.850 | 0.676 | 0.720 |
| Unseen 24, rerank BM25's top two, owner first | 14 | 14 | 13 | 15 |

"Pick `reach` if it is in the top two" scored 17 of the unseen 24. Four Clef
variants on the held-out 12 changed nothing or made it worse: the first 40
lines of each spec instead of 12 (0.674), one noul per component pooled to its
block (103 s per spec, wrong on the one spec it finished), and each block's
code directories in the state (0.663 against 0.658). Clef's noul answers were
mostly under 0.1, so it ranked on gaps the size of noise. These scripts were in
a scratch directory that was later wiped; only the numbers survive.

## Asking each block its relation to the work

**Date:** 2026-10-07

Every run above asks which block owns the work, with the blocks side by side.
Elastic's ESCI rerankers ask a different question: one candidate at a time,
what is this candidate's relation to the need? The policy that ranks the
answers is deterministic and outside the model. The thesis borrowed from that
was that a decision model's value is the relation, which lexical match cannot
see, and the expected result was more than BM25's 29 on the 35 hard pairs.

- **Setup.** For each of the 35 pairs, each of BM25's top two blocks went to the model
  alone, in a random order, without its BM25 rank. The state was the spec's
  first twelve lines and the block's Responsibility, Logical role, Boundary and
  component list. One choice with five fixed labels, none naming a block:
  PRIMARY (changing it is required), SUPPLIER (provides what the owner needs),
  CONSUMER (consumes what changes), CONSEQUENCE (needs tests or follow-up only),
  UNRELATED. Three phrasings, merged, plus four nouls. A block is ranked by
  P(PRIMARY), or by expected utility 1.0·PRIMARY + 0.3·SUPPLIER +
  0.15·CONSUMER + 0.05·CONSEQUENCE. Round 2 added each block's implementation
  coordinates to its state. BM25 sees those paths in the whole README.
  The script is `rel.py`, the scorer `rel_score.py`, and the answers `rel_*.json`.

Pairs right out of 35, and out of the 9 whose owner is not `reach`:

| | P(PRIMARY) | Expected utility | Non-`reach` 9 (EU) |
|---|---|---|---|
| BM25 first | 29 | 29 | 7 |
| "`reach` if offered, else BM25 first" | 32 | 32 | 6 |
| Julia | 14 | 17 | 4 |
| Julia, with code paths | 17 | 13 | 4 |
| Clef | 26 | 27 | 9 |
| Clef, with code paths | 28 | 28 | 9 |

- **Julia has no relation reading.** It put 0.48 on CONSEQUENCE and 0.36 on
  CONSUMER on average and argmaxed PRIMARY for 1 of 70 candidates. Its three
  phrasings scored 13, 14 and 17.
- **Clef's errors are not BM25's.** In both rounds it fixed 4 of BM25's 6
  misses (0031, 0043, 0079, 0089). It broke 6 of BM25's right answers in
  round 1 (0036, 0045, 0046, 0067, 0072, 0087) and 5 in round 2 (0036, 0045,
  0046, 0047, 0072), and every one has `reach` as an owner. It scores `reach`
  below `runtime`, `retention` and `stability`. With the code paths it got all
  9 pairs whose owner is not `reach` right on every scorer. Those 9 are not the
  7 pairs in the tr11 notebook entry: those are the pairs that do not offer
  `reach` at all, where BM25 scores 6. The margins are 0.01 to 0.24, and the
  round-1 phrasings scored 23, 27 and 28.
- **Neither model passed.** 28 is one pair short of 29, and four short of the
  `reach` rule.

## What the rounds taught

- **A round without a thesis is parameter search.** The variants above changed
  one input at a time with no claim that the result could refute. The one run
  with a thesis, the relation round, is the only one whose result says
  something about the model rather than about the input.
- **35 pairs cannot resolve a one-pair difference.** At 29 of 35 the binomial
  standard deviation is about 2.2 pairs, so 27, 28 and 29 are one result, and
  the 9 non-`reach` pairs are too few to carry Clef's 9 against BM25's 7.
- **The 44 specs are a development set.** Every run in this entry read them.
  A combination rule fitted to them, such as "`reach` unless Clef disagrees by
  a margin", would be fitted to the answers.
- **The commit set is not the way out.** Commit subjects were already ruled
  out as a gauge (notebook, B-hist): they are untranslated jargon and every
  text reader sits near random. Of the 437 commits whose changed files the
  chart assigns to exactly one block, 247 are `reach`.

## Are the names good enough to guide?

BM25's lead is evidence that the vocabulary is consistent: specs and chart
use the same coined words, and package and directory names carry the same
signal as the chart prose. It is not evidence that the names guide someone
who does not already use that vocabulary.

- **The tasks speak the chart's language.** The specs and the chart have the same authors, mostly agents.
- **The labels leak names.** A spec's owner comes from the paths the spec
  cites, mapped through the chart's implementation coordinates, and BM25 sees
  those paths.
- **Plain wording was measured once, and confounded.** tr1 and tr2 swapped
  the READMEs for 30-word plain block descriptions at the same time as they
  rewrote the tasks. Against those descriptions BM25 scored 0.702 on the raw
  spec, 0.682 on the spec with coined terms substituted word by word, and
  0.595 on a one-sentence plain restatement. Most of the drop from 0.883 comes
  from the shorter block text. No run rewrote the task and kept the READMEs.

The test that answers the question keeps the tasks and owners, rewrites each
task without coined terms, paths or package names, and measures how far BM25
falls. If it barely falls, the names guide. If it collapses, they guide only
the people who already know them. That is also the one place a model reading
meaning could do what BM25 cannot.

## What would settle it

A labelled set of work items spread across all eleven blocks, labelled by the
people who own them, and not written by whoever builds the model. With that,
the tr11 model is the starting point, and the comparison is Julia on BM25's top
two against BM25 alone, on pairs with and without `reach`.
