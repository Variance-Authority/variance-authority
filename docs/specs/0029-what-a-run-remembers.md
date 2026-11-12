# Spec 0029 — the index is a cache that can only widen

**Missing:** the `volatile` rule. A block whose observed test set differs
between two runs at the same revision is not marked, so a change that reaches
it is answered from whichever run wrote last. The rest of what this spec asked
for shipped: a block is kept across an edit by its address
([identity under an edit](../execution-record.md#identity-under-an-edit)), a
row is replaced only by a run in which the test completed and a partial run
unions ([ADR-0062](../context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md)),
and crossings travel in per-worker journals folded into one snapshot
([journals](../execution-record.md#journals)). The generation the completeness
rule is scoped to is [0044](0044-many-writers-one-record.md)'s.
**Built on:** [the execution record](../execution-record.md#blocks) (the blocks
this marks),
[ADR-0062](../context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md)
(when a row may be trusted rather than merely read),
[ADR-0040](../context/adr/0040-git-already-named-every-files-content.md) (a
cache keyed by what git already named, and the claim that no cache can change an
answer), [ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
(proof and explanation are different fields),
[ADR-0008](../context/adr/0008-per-profile-expectations.md) (blindness is not an
answer).

## Purpose

Every safety property of
[0027](0027-a-test-is-selected-by-what-it-executed.md) reduces to one
precondition, and it lives here:

> **A test may be excluded only if the index holds a complete, current
> observation of it.**

The two mistakes are not the same size. A test run when it need not have been
costs a test. A test skipped when it should have run produces a green suite over
unexecuted code — silently, because it is not in the report to be missing from.
Everything below is that asymmetry made structural rather than remembered.

## What would discharge it

**A block whose observed test set differs between two runs at the same
revision is `volatile`**, and a volatile block always widens. This is
[`merkle.ts`](../../packages/core/src/relate/merkle.ts)'s existing rule one
structure over, with the same justification: a record that cannot prove sameness
says so rather than being quietly trusted. The residue is honest and stated — a
non-deterministic block seen once cannot be known volatile until it has
disagreed once — and it is measurable, by running one revision twenty times and
counting the blocks that disagree. That count is the volatility floor
[0027](0027-a-test-is-selected-by-what-it-executed.md#what-decides-whether-this-ships)
pre-registers.

**Acceptance:** one revision run twenty times, with the count of blocks whose
test set differs published; then a change to a block that disagreed, which
selects every test any of those runs recorded against it.

## What it forecloses

**The condition's text is not part of a block's identity.** Hashing the
condition into the name looks like it buys reorder-safety. It does not: any edit
to a condition would mint new ids for the decision *and both its outcomes*, so
the tests recorded against them would be unreachable, and a condition edit would
select nothing. That is the unsafe direction, reached by a construction that
reads as rigour.

**Compaction may only widen.** Anything the record holds beside presence may
be dropped. A `(block, test)` presence bit may not. Dropping a whole row is permitted and
converts that block to *unknown*, which climbs the ladder — never to *empty*,
which does not.

**The index is never an input to correctness.** Missing, stale, foreign or
corrupt, it costs a full run and can never cost a skipped test. That is
[ADR-0040](../context/adr/0040-git-already-named-every-files-content.md)'s claim
for the scan caches, and holding it here is what makes where this index lives a
cost decision rather than a correctness one.

**An index built under one instrumentation mode cannot validate another.** The
probe set is part of the toolchain identity, so a run under another recipe
([journals](../execution-record.md#journals)) refuses to fold into the index
rather than silently mixing two block universes.
