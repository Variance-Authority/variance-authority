# Spec 0029 — the index is a cache that can only widen

**Missing:** the journal, the index, and the identity a block is stored under.
Nothing records a crossing, and the rule that decides when a recorded row may be
*trusted* — as opposed to merely read — does not exist anywhere.
**Built on:** [0028](0028-the-instrument.md) (which emits what this stores),
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

**1. A block's identity is structural, and ambiguity mints.** The key is
`<file path> ‖ <declaration name path> ‖ <structural path>` — `priceOf/if#0/else`
— and never a line, never a byte offset, never an opaque counter.
Reconciliation is exact match, then a **unique** match by the block's own digest
under the same reconciled parent, then **mint**. There is no similarity
threshold anywhere: a threshold is a knob whose two settings are *false matches*
and *missed matches*, and the choice between those is already made.

**The condition's text is deliberately not part of a block's identity.** This is
the decision most likely to be got wrong, because hashing the condition into the
name looks like it buys reorder-safety. It does not: any edit to a condition
would mint new ids for the decision *and both its outcomes*, so the tests
recorded against them would be unreachable, and a condition edit would select
nothing. That is the unsafe direction, reached by a construction that reads as
rigour.

**2. A test's identity needs no reconciliation at all**, which removes a
subsystem the shape of this problem implies. The key is the origin file plus the
path of `describe`/`test` names; a story is its file plus its export name;
`.each` carries the **unformatted** template plus a row key, so a case is stable
across runs and a genuinely different row mints a genuinely different test. A
renamed or moved test has no row, and no row means *run it* — the fallback is
already the safe direction.

**3. The completeness rule, and it is the one that is easy to get wrong.**

> **A row is replaced only by a run in which the test completed. Otherwise it is
> unioned.**

A test that fails at its third assertion never executes the rest of its body, so
what it flushes is a *prefix* of its real reach. Replacing wholesale on that
flush shrinks the recorded reach permanently and silently. Union-within-a-
generation is monotone by construction, and monotone is the property being
bought.

The same rule covers the rest of the incomplete cases, each of which resolves to
*run it*: a skipped test, a crashed worker, a timeout, and a run that executed
only a shard or a selection. **A partial run contributes crossings and never
writes completeness** — or the second selected run believes the whole suite is
observed on the strength of one narrow one.

**4. A block whose observed test set differs between two runs at the same
revision is `volatile`**, and a volatile block always widens. This is
[`merkle.ts`](../../packages/core/src/relate/merkle.ts)'s existing rule one
structure over, with the same justification: a record that cannot prove sameness
says so rather than being quietly trusted. The residue is honest and stated — a
non-deterministic block seen once cannot be known volatile until it has
disagreed once — and it is measurable before anything else is built, by running
one revision twenty times and counting the blocks that disagree.

**5. Three layers, and no collector process.** A per-worker typed array during
execution; an append-only per-worker journal, framed and checksummed so a torn
tail is detected rather than inherited; a merged index keyed by the blob oid of
the file each block came from. Derived for this repository — 2,233 runtime
tests, a few hundred crossings each — the whole index is **about 2.6 MiB**,
which is small enough that the encoding is not where the effort belongs.

The brief floats a bundled Rust collector process. It is refused for v1 on the
same gate as
[ADR-0004](../context/adr/0004-defer-native-acceleration.md): the design spikes
put per-test transport cost far below a millisecond either way, which is
invisible against a 38.29 s suite, and a socket costs a child process, a drop
policy, a hang timeout, a Windows pipe path and a durability story that files
get for free. A collector is justified by a measurement showing files are the
bottleneck.

**Acceptance:** a suite run twice with an unrelated failure injected on the
second run, where the failing test's recorded reach does not shrink. Then the
same suite run as two shards, where neither shard marks the other's tests
observed.

## What it forecloses

**Compaction may only widen.** Counts, trie nodes and distances may be dropped.
A `(block, test)` presence bit may not. Dropping a whole row is permitted and
converts that block to *unknown*, which climbs the ladder — never to *empty*,
which does not.

**The index is never an input to correctness.** Missing, stale, foreign or
corrupt, it costs a full run and can never cost a skipped test. That is
[ADR-0040](../context/adr/0040-git-already-named-every-files-content.md)'s claim
for the scan caches, and holding it here is what makes where this index lives a
cost decision rather than a correctness one.

**An index built under one instrumentation mode cannot validate another.** The
probe set is part of the toolchain identity, so turning ternaries on
([0028](0028-the-instrument.md)) discards the index rather than silently mixing
two block universes.
