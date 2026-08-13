# ADR-0039 — the digest is the proof, the trail is the explanation

**Status:** accepted
**Date:** 2026-08-13
**Relates to:** [ADR-0010](0010-tier-specific-environment-keys.md),
[ADR-0038](0038-a-change-reaches-a-component-through-files.md),
[`packages/core/src/relate/merkle.ts`](../../../packages/core/src/relate/merkle.ts),
[`docs/specs/0026-selection-by-closure-digest.md`](../../specs/0026-selection-by-closure-digest.md)

## Context

ADR-0038 selects by reachability: walk the graph backwards from the files a diff
named. That answer is only ever as good as the diff, and the diff is the part CI
gets wrong. It needs `git`, a ref that exists, a checkout deep enough to contain
the merge base, and the assumption that the ref is where this branch actually
diverged. A shallow clone has no merge base. A rebase moves it. A squash rewrites
it. A branch switch changes it entirely. Every one of those failures widens a run,
which is safe — and one of them, a `--since` pointed at the wrong ref, narrows it,
which is not.

Reachability also answers a question nobody asked in one common case. A change
followed by a revert leaves both commits in the diff, so the file is reported
changed and everything resting on it is observed, to discover that the bytes are
the ones the baseline was painted from.

The other construction is the one build systems settled on decades ago. `bazel`
keys an action by a hash over its inputs and their inputs, transitively, and asks
*is this closure byte-identical to the one that produced the artifact I already
have*. It consults no history, no ref and no diff. This project already content-
addresses one level in — a document digest names a render — and the same idea one
level out names the source that produced it.

## Decision

**One digest per node, over the node's own content and the digests of everything
it rests on.** `closureOf` produces the map; `driftedBetween` compares two of them.

**Cycles are condensed, not broken.** A dependency graph has cycles and a Merkle
tree cannot. Strongly connected components are found in one Tarjan pass and hashed
as a unit, so every file in a cycle carries the same digest — which is exactly the
truth about a cycle: no member of one can be called unchanged while another moved.
Tarjan emits a component only after everything it can reach, so a dependency's
digest is always already computed when it is read, and the whole thing is
`O(n + m)`.

**A digest that cannot prove sameness says so.** A file whose content was not
supplied, or whose own imports could not be read, breaks the claim the digest
makes: its closure may have moved with nothing in this structure changing. Those
nodes are **volatile**, the mark propagates to everything resting on them, and
`driftedBetween` reports a volatile node as changed however its digest compares. A
node is also changed when it is simply *new*. Three ways into `changed` and only
one of them is a difference.

**A component contributes `(declared)`, not bytes.** A component has no content of
its own; its content is the file that declares it, which it already depends on.
An unread file contributes `(unread)`, which is a term that cannot collide with a
digest.

**Both answers ship, and neither replaces the other.** The trail is the
explanation and the digest is the proof:

| situation | reachability | closure digest |
|---|---|---|
| a change, then a revert | both commits are in the diff, so it widens | identical digest, nothing runs |
| rebase, squash, branch switch | the merge base moves and the diff with it | unaffected — no ref is consulted |
| a shallow clone with no merge base | cannot answer; runs everything | unaffected |
| *why* is this subject being observed | a chain of files a person can read | a digest that differs |

A run wants the digest to decide and the trail to justify.

## Consequences

**It is comparable to nothing until something stores it.** A closure digest is
only useful against an earlier one, and the earlier one has to live beside the
baseline it corresponds to. That is
[spec 0026](../../specs/0026-selection-by-closure-digest.md); until it lands,
selection answers from reachability and this is a function `core` exports with
its own tests.

**The edge-kind filter is part of the digest, not a caller's convenience.**
`through` restricts the closure to chosen edge kinds — code only, ignoring assets
— and two digests taken through different kinds are not comparable. That is
ADR-0010's rule one layer down — a key that does not name every input is a key
that compares two different questions — and it is why the filter is an input to
the hash rather than a post-filter over it.

**It forecloses hashing a file list.** The obvious cheap version — hash the
digests of the files a subject's components are declared in — is a different
claim, and a wrong one: it goes unchanged when a token file two hops away moves.
The transitive closure is the whole point, and the cost of it is the graph.

**A repository with no `git` gets nothing from this.** Content digests come from
somewhere, and the somewhere is ADR-0040. A scan that hashed nothing produces a
closure that is entirely volatile, which is correct and useless — and, importantly,
not silently wrong.

## Alternatives

**Digest the diff instead** — hash the changed-file list and skip when it matches.
Rejected. It answers *did this run's diff match last run's diff*, which is a fact
about two `git` invocations rather than about the source, and it inherits every
failure mode that made reachability fragile.

**Store a timestamp or a commit sha per subject.** Rejected. Both are proxies for
content that go stale in the unsafe direction: a commit sha differs when nothing
that matters moved, and matches when a working tree is dirty.

**Break cycles by dropping a back edge.** Rejected. Which edge gets dropped
decides which file appears unchanged, and nothing in the structure justifies the
choice. Condensing says the true thing instead.

**Trust a digest over partially-read inputs, and warn.** Rejected for the reason
the whole project refuses it elsewhere: a warning attached to a hash is a hash
people compare and a warning nobody reads, and the outcome is a subject skipped on
the strength of bytes nobody hashed.
