# ADR-0034 — a divergence must survive the children it excludes

**Status:** accepted
**Date:** 2026-08-12
**Relates to:** [`composition.md`](../../composition.md),
[ADR-0033](0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)

## Context

The cross-subject join makes a new claim available: *the same component, the
same inputs, more than one rendering, at one commit*. It is not a regression —
there is no baseline anywhere in it — and it is worth reporting because it says
the component's own inputs do not decide its output.

The first implementation of it reported **eleven** on
[`examples/todomvc`](../../../examples/todomvc). All eleven were false, and they
were false in three different ways.

The cause is one line in `packages/react/src/resolve.ts`: `digestableProps`
excludes `children`. That exclusion is correct and load-bearing — children are
elements, elements are not serialisable, and digesting them would make every
props digest a digest of the whole subtree and join nothing with anything. But
it means **a props digest is not a statement of a component's inputs**, and a
claim phrased as "the same inputs" cannot be built on it without saying what it
does about the gap.

## Decision

**An input is a props digest, and a pair the excluded field could explain is
refused rather than reported.**

Three refusals, one per shape the measurement found.

**Two boundaries of one component in one subject are not one node rendered
twice.** A `TextField` walked as two boundaries sharing a props digest is two
places on one page, and two places on one page are allowed to look different.
A rendering set whose sites collide within a subject is refused.

**Different children are not the same input.** `Card` and `Text` "diverged"
purely because the field the digest omits was the field that differed. Where the
text content of two renderings differs, the digest is not evidence of equal
inputs and the pair is dropped.

**Different rendered subtrees are not the same input.** Two sites that mount
different components below them were called with different elements, whatever
their props digest says. The ordered list of components each site renders has to
match.

What survives all three is a pair of renderings that share a props digest, share
their text, mount the same components in the same order, and occur in different
subjects. The measured answer on todomvc is then **zero**, which is the correct
answer, and zero is what the report says.

## Consequences

**The report cannot find a real divergence that differs only in its children's
arrangement.** A component whose two renderings genuinely disagree *and* happen
to mount different subtrees is refused by the third rule, and nothing counts it.
This is a false-negative rate nobody here can measure, traded for a false-
positive rate that was measured at 100%.

**Zero is now a load-bearing answer and has to be printed as one.** An empty
divergence list means "nothing rendered two ways from one input", not "this was
not computed", and the tool and the record both say which. An empty list that
reads as absence is how a suite stops asking a question it thinks it asked.

**`contradicted` — the fourth rung of the attribution ladder — is only as good
as these refusals.** It tells a reviewer the change is not in the component's own
code, which is a strong claim from weak evidence if the divergence behind it is
an artifact of the digest. Every rung below it inherits the same dependency:
eleven false divergences would have absorbed eleven movements that belonged in
the unexplained shortlist.

**The refusals are cheap and stay in `core`.** They are set and equality work
over data the join already assembled, so the cost is not the reason to relax
them, and there is no configuration to turn them off. A relaxable soundness rule
is a rule somebody relaxes on the day the report is embarrassing.

## Alternatives

**Digest the children too.** The obvious fix and the one that destroys the
feature. A props digest covering the rendered subtree is a digest of the
subtree, so two identical buttons in two pages no longer share an input, no
component joins with itself across subjects, and the graph has no edges left to
find.

**Report the pairs and label them "may be explained by children".** Rejected on
what a labelled finding does. Eleven entries with a hedge is still eleven
entries in a list somebody has to walk, and a hedge that applies to all of them
is a hedge nobody reads twice. A finding that cannot be acted on is noise with a
disclaimer.

**Compare the child *count* instead of the rendered components.** Cheaper and
weaker: two sites mounting different components in equal numbers pass it, which
is exactly the `Card` case. The ordered component list costs the same fold and
is not fooled by arity.

**Let a sensitivity level decide which refusals apply.** Correct in shape — it
is how band relaxation works elsewhere — and rejected because these are not
policy. A sensitivity says *which differences this route asserts on*; these say
*which pairs are comparable at all*, which is a soundness question and not the
operator's to answer.
