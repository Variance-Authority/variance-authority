---
'@variance-authority/core': minor
'@variance-authority/report': minor
'@variance-authority/sense': patch
---

A run leaves behind what its suite looked like, in bytes another checkout can read

A run report answers about *this run*. Nothing answered about the suite from
somewhere else: which components exist, which subjects hold them, which of them
has an example of its own, and every name the run indexed. A branch asking any
of that against `main` had nothing to ask, because `main`'s answers were computed
on a machine that has since gone away — which is why *this component is not
covered anywhere* was a question with no reader, and why a second run could only
re-derive what the first already knew.

`@variance-authority/report/suite-index` is that artifact. `suiteIndexOf` takes
the baseline-bearing half of a report — the census, the subject denominator it is
counted against, and the lexicon — and `encodeSuiteIndex` writes it as one
segment, with `readSuiteIndex` and `writeSuiteIndex` beside the report's own file
functions. The other half of a composition does not travel: `movements` is what
moved since a comparison nobody else made, and `divergences` and `echoes` are
readings of one commit's snapshots. None of the three is a fact about the suite.

It carries the commit it was written at and nothing else about where it is, which
is the rule the selection index already settled — a commit answers *what changed
since this was written* exactly, and a timestamp says when a machine was rather
than where a tree was. An index that cannot name itself is the honest record of a
run that could not, and a reader holding one has nothing to diff.

It is not JSON. A lexicon is the same few thousand strings written once per
subject that holds them, and in JSON the repetition *is* the payload. Interned
once and referenced by number it stops being one, and equal facts encode to equal
bytes — a sorted dictionary, so a cache that keys on content actually hits.

`@variance-authority/core/segment` is the arithmetic underneath: named columns,
alignment, interned strings, and the validation a decode performs before it
believes a file. A column's width comes from the array's own type, so a mismatch
is a compile error rather than a decode against the wrong stride, and a malformed
reference rejects the whole file — a segment is a cache or a baseline, both of
which may be rebuilt, and half of either is worse than neither. The source index
now reads and writes through it and keeps its own bytes; what it still owns is the
part that is about source.
