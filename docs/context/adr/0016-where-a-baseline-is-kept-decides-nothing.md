# ADR-0016 — Where a baseline is kept decides nothing

**Status:** accepted
**Date:** 2026-08-03
**Amended by:** [ADR-0090](0090-a-moved-identity-is-a-cause-not-a-verdict.md) — a run compares against an image another machine painted, with the identity named as the cause; the partition keys the store, it does not refuse; [ADR-0091](0091-a-baseline-is-named-for-its-subject.md) — a baseline's path is the operator's template, with no identity in it, and what `createLfsStore` delegates is that template
**Extends:** ADR-0011 (durable and ephemeral retention), ADR-0013 (packages are named for their requirements)
**Discharges:** spec 0004

## Context

ADR-0011 settles what a baseline *is* and how it is keyed: an artifact with its
own retention, partitioned by renderer identity, so that a run on one machine
cannot compare against an image another machine painted. It says nothing about
where the bytes live, and the first implementation put them in a local directory
— correct for one machine and useless for a team.

Three places are plausible and each brings a different failure. A directory is
free and unshareable. An HTTP endpoint is shareable and introduces a network call
into the path that decides a verdict. Files in the repository are shareable with
no infrastructure at all, and put a machine-produced artifact under human merge
resolution — the objection that killed the file-based *record* of hashes in the
same cycle (spec 0002, epitaphs).

That last objection turns out not to reach an image, and the difference is worth
naming because it decides the default. A record of hashes is merged: two branches
observing different values for one key produce a conflict whose correct
resolution is neither side, and a person resolving it by hand can get it subtly
half-right in a way nothing detects. **A baseline image is never merged.** A
conflict is settled by taking one side, which is a decision a person makes in
seconds and cannot get half-right.

## Decision

**Three backends, chosen by configuration, and the choice must not be visible in
any answer.**

- **git-LFS is the default**, because it needs no service, no bucket, no
  credentials and no second thing to keep running: turning durable mode on costs
  one line in `.gitattributes`.
- **A local directory** for a single machine.
- **An HTTP endpoint** the operator runs, for a team that wants one.

Four rules follow.

**The identity partition is preserved by all three, by delegation rather than by
agreement.** `createLfsStore` computes no path of its own; every path decision
goes to `createDurableStore`, so `<root>/<identityDigest>/<subject>` exists once.
A second copy of that layout is a second chance to get the partition wrong, and
the partition is the only thing standing between a runner-image upgrade and a day
of unattributable red.

**A store that cannot answer produces an operator error, never a verdict.** An
unreachable endpoint, a refused token, a failing disk: none of them is `new` and
none of them is `unchanged`. This is the same rule as ADR-0015's exit-code
argument seen from the storage end, and the reason it is load-bearing rather than
tidy is that `new` **re-records whatever is on screen** — so a network failure
reported as a missing baseline destroys the baseline the run existed to compare
against.

**An LFS pointer is refused by name.** On a clone without git-lfs installed the
working tree holds 130 bytes of pointer text where the PNG should be. Handing it
back produces a decode error blamed on the renderer; reporting it as absent
re-records. So the signature is checked and the error names
`git lfs install && git lfs pull`.

**Nothing shells out to git to read or write an image.** (Amended by
[ADR-0092](0092-an-lfs-checkout-fetches-what-it-compares.md): a pointer met by
`find` is fetched with `git lfs pull --include`.) LFS is a clean/smudge
filter, so a checked-out tree already holds the real PNG at the real path. `git`
is consulted for exactly one thing — `check-attr`, to ask what the filter
actually resolves to — and its absence degrades to a diagnostic rather than a
failed run, because a machine without git can read and write the directory
perfectly well.

## Consequences

**Switching stores changes no verdict, and that is a test rather than an
intention.** `packages/observe/src/parity.test.ts` runs every scenario through
all three implementations and asserts one answer. It includes the *cheap* lookup
deliberately: `describe` decides whether a subject is compared at all, so a store
that answered it differently would change verdicts without ever touching a pixel
— the acceptance criterion broken by the one query that never reads an image.

**The shared checks live in the package neither backend owns.** `sidecarFrom` is
in `raster`, because two copies of "what a baseline is" are two ideas of it, and
the one that drifts is the one that accepts a record the other refuses.

**The LFS store does not verify the pointer on the cheap path, and says so.**
`describe` reads the `.json` sidecar, which is deliberately outside the tracked
glob and is therefore real text on every clone. On a broken checkout a run where
nothing changed passes green without discovering that the tree holds pointers;
the operator finds out on the first subject that moves, from
`tracking.diagnostics` at open, or from `variance doctor`, which reads the head of every image once and exits 2 on a
pointer git-lfs cannot fetch here ([ADR-0092](0092-an-lfs-checkout-fetches-what-it-compares.md)). Reading it on every run would spend the lookup that method exists to
avoid, on every subject, to report a condition doctor already reports. The
composite action asks `variance doctor --baselines`, the store half alone with
no browser opened, before every run over a store in the checkout, so a job that
uses the action stops on such a checkout instead of passing. The
signature is the store's (`isLfsPointer`), not the codec's: the store knows which
backend can hand back a pointer, and doctor asks the same function the store
refuses with.

**git-LFS is exercised as git-LFS.** The `lfs` job of `variance.yml` keeps the
case's baselines in git-LFS on this repository's own pull requests: its label
commits them back to the contributor's branch through the composite action and
the real clean filter. Once a branch holds them, every run asserts that
`doctor --baselines` exits 2 on the checkout before git-lfs is installed, then
fetches the objects and checks each against the digest its pointer names.

**The render cache lands under the baseline root by default, and is therefore
committed.** That is the correct behaviour rather than an oversight: it is what
the durable store does, and this ADR forbids the LFS backend from behaving
differently. It is also expensive, since the cache is keyed by document digest
and is worth nothing after one edit, so `cacheRoot` exists to point it outside
the work tree. `run.test.ts` holds the default in place.
