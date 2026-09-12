---
'@variance-authority/tribunal': minor
---

One object per picture, and a sweep that can tell what nothing wants

Every key this service wrote was derived from where the bytes came from rather
than from what they are: a baseline under the identity that painted it, a cache
entry under its document digest, a build image under the build id. Two
byte-identical PNGs therefore always landed at two keys, by construction. An
unchanged suite of 300 subjects over 200 builds stored 60,300 objects holding
300 distinct pictures, approving copied an image the bucket already had through
this process twice, and the `before` each run uploaded was a second copy of a
baseline this deployment had handed that run itself over `/baseline/find`.

Images are now addressed by their own SHA-256. A baseline, the candidate it was
promoted from, and the `before` of every run since are one object with three
rows naming it, and a promotion writes a row and no bytes. Old keys still read:
a key is a column, not something a lookup derives, so a deployment upgrades
without moving an object.

Sharing one object removes the property that made deletion simple — a build's
`before` could not have been the baseline, because the baseline was elsewhere —
so the sweep no longer deletes per build. A new `objects` table claims every key
this package writes, and the sweep removes the ones no baseline, cache entry or
build subject refers to and that nothing has stored or matched for the whole
retention window. That ledger also closes a hole that predates content keys:
`store.ts` said an object written before its row was "removed by the next
sweep", and it never was, because every key the sweep knew came from a row and
`R2Like` has no `list`. Those were unreachable forever; they are ordinary rows
now.

**A build nobody has finished reviewing outlives its window.** The sweep used to
count a build's decisions and then delete its images anyway, which took the
`after` out from under every undecided `changed` subject — `decide` afterwards
refused with "the bucket has no such object", so the change became permanently
unapprovable through this service, by the retention policy, silently. Such a
build is kept, and `SweepReport` gained `held` so a review queue nobody is
working shows up as a number rather than as missing evidence. `ephemeral` builds
are exempt: both of their images were painted in one run and compared against
each other, so no decision about one can reach a stored baseline.

The nine `DELETE`s that remove a build now travel in one `batch`. Run
separately, a failure in the middle left a build whose subjects were gone and
whose reach rows were not — a row set no page renders and no later sweep
revisits, since the `builds` row it selects on went last.

`render_cache` was the one table nothing ever removed a row from. The sweep now
drops entries older than the same window and reports them as `cached`; an entry
is pure optimisation, so the loss of one costs a re-render of a document nothing
has asked for in the whole retention period.
