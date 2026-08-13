# Spec 0026 — a subject skipped because its inputs are provably the ones it had

**Missing:** the storage and the comparison. `closureOf` and `driftedBetween`
exist, are tested, and answer *did this subject's entire input closure move* — and
nothing in a run consults them, because a closure digest is only meaningful
against an earlier one and no earlier one is written down anywhere.
**Built on:** [ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
(the construction, the cycles, the volatile rule),
[ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md) (the
graph it hashes), and
[ADR-0027](../context/adr/0027-a-baseline-carries-what-its-document-said.md) (the
sidecar that already carries what a baseline knows about itself).

## Purpose

Selection today asks *what did this diff reach*, which requires a diff, which
requires `git`, a ref that exists, a checkout deep enough to hold the merge base,
and the assumption that the ref is where this branch diverged. Those fail in CI
routinely, and each failure is either a wider run or — when `--since` names the
wrong ref — a narrower one nobody notices.

The digest asks a question with none of those inputs: *is what this subject rests
on byte-identical to what it rested on when its baseline was painted?* A revert
answers yes. A rebase, a squash and a branch switch do not change the answer at
all, because no ref is consulted.

## What would discharge it

**The digest travels with the baseline, and the comparison is one lookup.**

**1. The sidecar carries a closure digest per subject.** ADR-0027 already puts a
description beside every stored baseline — the components its document rendered —
and that is the natural place: the components are the keys, and the digest of each
one's closure is the value. Writing it costs one scan the run has already paid for
when `source.relations` is on, and nothing at all when it is off, in which case the
field is absent and means *unknown* rather than *unchanged*.

**2. The selector prefers the digest and keeps the trail.** A subject whose every
recorded component still hashes to what the sidecar holds is skipped, whatever the
diff said. A subject with any component missing, volatile, or newly present is
observed. Reachability continues to run, and the reason printed in the report is
still the chain of files — because "a digest differs" is a proof and not an
explanation, and the person reading the report needs the second one.

**3. The absent field is not a match.** A baseline written before this exists, a
run with no graph, and a run whose scan could not read a file all produce *no
digest*, and none of them may compare equal to a digest. This is the same rule as
every other absence in the system, and it is the one that has to be tested rather
than argued.

**4. The edge kinds are part of the key.** Two closures taken through different
edge kinds answer different questions and must not be compared. Whatever the run
hashed through is recorded beside the digest, and a mismatch is *unknown*, never
*unchanged*.

**Acceptance, and it is a scenario rather than a unit test:** a repository where a
token file is edited and then reverted across two commits. Reachability observes
the subject — both commits are in the diff. The digest skips it, and the report
says which of the two decided. Second scenario: the same tree, scanned from a
shallow clone with no merge base, where the diff cannot be computed at all and the
digest still answers.

## What it forecloses

**It cannot be added to a baseline later without a scan.** A repository turning
this on gets one whole run, because no stored baseline carries a digest yet. That
is the correct cost and it is worth stating in advance rather than filing as a
surprise.

**It does not remove the graph.** The digest is over a closure the graph defines,
so everything ADR-0038 requires — a scan, a resolver, an honest account of what
could not be read — is still required. What it removes is the dependence on `git`
history being shaped the way CI assumed.
