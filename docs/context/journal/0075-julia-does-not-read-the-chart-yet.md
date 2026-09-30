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
choice and never beat BM25 on content. Every script, rank file and the run-by-run
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
  on content. The shared jargon between specs and READMEs is what BM25 wins on,
  and translating it away cost BM25 0.19 MRR as well.
- **This gauge cannot tell reasoning from a prior.** With one block owning two
  thirds of the labels, a model that leans toward it wins the hard pairs
  without reading them. The fifteen specs `reach` does not own contain seven
  hard pairs, too few to resolve a difference. The commit-history set is no
  better: 85 of 109 items are `reach`, and it covers seven blocks.
- **Synthetic queries alone do not fix it.** Spec-shaped proposals written
  from the chart, the remedy the retrieval literature gives for training on
  document text (DSI-QG, InPars, GPL), collapsed the model onto one block.

## What would settle it

A labelled set of work items spread across all eleven blocks, labelled by the
people who own them, and not written by whoever builds the model. With that,
the tr11 model is the starting point, and the comparison is Julia on BM25's top
two against BM25 alone, on pairs with and without `reach`.
