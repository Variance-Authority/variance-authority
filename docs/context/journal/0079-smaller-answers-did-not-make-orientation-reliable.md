# Smaller answers did not make orientation reliable

**Date:** 2026-11-21

Orientation trials on a private product monorepo gave fresh agents historical
tasks and 120 seconds to submit coding starting files. They could search only
through the public Variance CLI and read source paths an answer had named. The
build and source index stayed fixed during each trial. Expected paths were
withheld until submission, then supplied for reflection. Historical paths that
had disappeared were scored separately from verified current owners: one
expected wrapper had become a compatibility re-export, and the agent that chose
its current implementation instead was credited with the owner, not the path.

The frozen candidate build was `d3410c704`, combining main with PRs #1671,
#1676 and #1681. The bounded preview result and expansion audit are also
recorded on
[issue #1682](https://github.com/Variance-Authority/variance-authority/issues/1682#issuecomment-7056510523).
The corpus is private, so the answer sizes below are rounded and the trials
cannot be reproduced from this repository.

## What survived measurement

PR #1681 reduced one orient answer from about 100 KB to about 12 KB by showing
three declarations per dependency and naming the omitted count and expansion.
An experimental discover preview reduced a messaging task's answer from about
31 KB to about 6 KB; all seven expansion commands recovered the original
evidence rows. These establish smaller answers and recoverable evidence, not
better task completion. The discover preview remains an experiment.

The orient replay compared the two answers for one file:

```sh
variance ask orient --files "$file" > compact.txt
variance ask orient --files "$file" --declarations > expanded.txt
wc -c compact.txt expanded.txt
```

The preview's source question, on a different file, was
`ask discover --to "$other_file" --text '<task words>' --limit 20`. Its
renderer kept the first three numbered evidence lines per file and emitted a
per-file question with an exact `--path`. That prototype is not published.

Changing prompts did not establish reliable orientation. Representative trials,
each submitted within the two minutes:

| Protocol and task | Verified result |
| --- | --- |
| Owner chain, messaging upgrade | 3 of 3 expected files |
| Owner chain, hub fallback | 0 of 4 |
| Short protocol, migration | 2 of 4 |
| Short protocol, messaging upgrade | 2 of 3 |
| Short protocol, saved views | Both current responsibilities |
| Exact provider supplied, hub control | 2 of 4 |

The protocols differed, tasks were repeated with fresh agents, and this is no
randomized estimate of treatment effect. The best run is not a reliability
claim. The shorter protocol reserved the final 30 seconds for submission;
earlier protocols allowed source queries for 105 seconds. Two other trials
submitted after 120 seconds and failed the deadline.

## Where attention went

Correct owners appeared, but agents continued searching old configuration
symptoms instead of reading the current feature's integration. A hub control
given the provider still skipped the view it imports. A broad dependency query
then produced thousands of matches and overwhelmed the nearby relationships.
Search also put platform integration names above the hub's owners, and an
external constant above local migration transforms.

The graph is not directory membership or runtime execution. A cleanup codemod
loads its transform through a path string, so following imports cannot expose
that registration. The main migration has a type import to its transform; that
accidental edge must not become an assumed contract. A messaging agent found
the right example's line, read the start of the file instead, and omitted the
newer scenario from its final shortlist.

The skill correction removes a mandatory search → symbol → uses sequence,
routes source-line patterns through scoped Variance grep, and separates path
membership, import reach, runtime strings and representative fixtures. It does
not encode the answer keys or claim these instructions solve the trials.

The next experiment is grouping complete search candidates by the code map's
areas and layers before display caps, under #1652. Matching remains lexical;
PR #1659's whole-name classifier is available but did not derive task owners
whose names the request never spells. Candidate presentation and the move from
a plausible owner to the remaining responsibilities are still open problems.
