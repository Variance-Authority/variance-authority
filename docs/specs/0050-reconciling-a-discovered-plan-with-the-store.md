# Spec 0050 — reconciling a discovered plan with the store

**Missing:** everything after the sentence. The run now names the approved
subjects its plan did not contain ([ADR-0063](../context/adr/0063-a-plan-that-is-discovered-is-half-a-list.md)),
and that is the whole capability: a warning, no verdict, no exit code, and no
command that does anything with the names. Nobody can act on the report without
deleting files by hand, and the report cannot tell the operator *which* of the
two things it is looking at — a subject the collector stopped listing, or a
second suite sharing the baseline root.
**Built on:** [ADR-0063](../context/adr/0063-a-plan-that-is-discovered-is-half-a-list.md)
(the signal, and the four constraints it ships under),
[ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md) (the identity
partition, which is what makes a set difference answerable at all),
[ADR-0016](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) (a
store may not change a verdict, which is why this is a warning),
[0023](0023-accept-tells-new-from-changed.md) (a precondition — see §3),
[0040](0040-a-baseline-in-git-is-a-picture.md) (where the record lives, which
decides what a walk can even enumerate).
**Packages:** `@variance-authority/raster` (the optional store method),
`@variance-authority/store` (the walk), `@variance-authority/cli` (the sentence,
and the commands that do not exist yet).

## Purpose

A declared plan is a list somebody reviews: removing a subject is a diff against
`subjects.ids`, and the removal is the thing being approved. A **discovered**
plan — a sitemap, a story index, a directory of built HTML — is not. Its
asymmetry is the problem:

- Adding a subject is loud. There is no baseline, the run reports `new`, and it
  exits `1` until somebody approves it.
- Removing one was silent in both directions. The subject is never collected, so
  no verdict names it, and its approved image stays on disk looking exactly like
  a baseline still being honoured. **The suite gets smaller and greener at the
  same time.**

The sentence closes the first half of that: the run says the names. What it does
not close is what the names are *for*. An operator reading

> the baseline store holds 3 approved subjects this run did not plan: …

has been told a fact and handed no verb. The image is still there, the store
still answers `find` for it, `accept` will still promote over it, and the next
run says the same sentence again — forever, if the second reading is the true
one and two suites really do share the root.

## 1. The two readings are not separable today, and could be

The sentence names both readings because the run genuinely cannot tell them
apart. A baseline record says what was painted and by which renderer identity;
it does not say **which suite approved it**. So a component suite and a route
suite pointed at one `baselines.root` each report the other's entire subject
list, correctly and uselessly.

The fix is not a heuristic over ids. It is a field:

```ts
// Proposed, on the record — not on the key, and not in the path.
interface Raster {
  /** The `project` of the run that approved this baseline. */
  readonly project?: string;
}
```

With it, `unplanned` takes the set difference within one project and the second
reading disappears: a name that comes back is a subject *this* suite approved
and *this* suite stopped planning. Without it the sentence must keep naming both
readings, which is why it does.

Three constraints on that field, all inherited:

- **Optional means unknown, never none.** A record written before the field
  existed has no project, and a run that read it as *belongs to nobody* would
  report every pre-existing baseline as unplanned exactly once — a false alarm at
  the worst possible moment, on the upgrade. An absent project matches every
  project.
- **It is a record field, not a path segment.** Putting it in the path would
  repartition every existing store, which is an ADR-0016 violation dressed as a
  migration: the same pixels, a different verdict, because of where they live.
- **It does not enter the identity digest.** Two projects painting the same
  document on the same machine must still share a render cache entry.

## 2. Nothing removes a baseline, and that is a gap with a shape

There is no verb. `accept` promotes a candidate the run produced, `push` commits
what `accept` approved, and neither has a way to say *this subject is over*. The
missing command is a deletion, which makes it the most dangerous one in the tool,
so it gets the narrowest possible contract:

> `variance forget <subject>` removes the record and the image for exactly the
> subjects named, under exactly this run's identity, and refuses any subject the
> most recent report did not list as unplanned.

Four refusals, each of which is the whole point:

- **Never a glob over everything held.** `--all` is the shape that turns this
  into "delete the baselines this laptop's renderer did not paint", which is
  every baseline, on the first developer to run it on a different OS.
- **Never inferred from a run.** A run that deleted what it did not plan would
  make a sitemap outage into a permanent loss of every approved image, and the
  run that did it would exit `0`.
- **Never across identities.** Removing `home.html` on macOS may not remove the
  Linux runner's `home.html`, which is the only copy CI compares against.
- **Never without the report.** The names come from the artifact of a run that
  actually planned the suite, so a `--subjects`-sharded run cannot authorise a
  deletion it only saw a shard of.

## 3. The state `forget` must not create

Deleting the image and keeping the record, or the reverse, produces the half-pair
`readRaster` throws on — and under [0040](0040-a-baseline-in-git-is-a-picture.md)
the two halves may live in two stores, so *both* deletions have to be ordered and
both have to be survivable when the second fails. The safe order is record last:
an image with no record is the ordinary state of a fresh clone, and a record with
no image is corruption.

A subject that is forgotten and then reappears in the sitemap is `new`, which is
correct and is [0023](0023-accept-tells-new-from-changed.md)'s problem: until
`accept` tells a never-reviewed subject from a just-regressed one, `--all` will
promote the reappearance without anybody looking at it. That makes 0023 a
precondition for `forget` being useful rather than merely safe.

## 4. The stores that cannot answer

`unplanned` is optional, and today two of four backends do not implement it:
the ephemeral store holds nothing across runs, which is correct, and the **remote
store does not**, which is not. A hosted baseline service is precisely where a
suite's images outlive the code that asked for them, and it is the one backend
where the answer needs a list endpoint rather than a walk.

The contract is already written for this: absence means *unknown*, so a remote
store silently produces no sentence rather than a wrong one. But the silence is
indistinguishable from a clean suite, and the operator cannot tell which they
have. Two things are missing:

- a `GET /baselines?identity=…` on `tribunal` and the client half in the remote
  store;
- a line in `variance doctor` that says which of the configured store's optional
  methods are absent, so *this run cannot report abandoned baselines* is a fact
  somebody can read before they rely on it.

The second is worth more than the first and is a day's work.

## What it forecloses

**Making it a verdict.** An unplanned subject is not a failure of the run: the
run compared everything it planned and every comparison stands. Moving the exit
code would make a shared baseline root a red build, and the tool would be wrong
in the direction that gets a check disabled.

**Asking the question of what ran.** Every narrowing — `--since`, `--subjects`, a
selection index — is downstream of the plan, and `plan.subjects` stays whole
precisely so this question can be asked on a partial run. Asked of the observed
subjects instead, a narrowed run would report its entire saving as a suite of
abandoned baselines. This is a caller obligation with a test against it, and no
future narrowing may be implemented by editing the plan.

**Answering with keys.** `fileNameFor` percent-encodes an id and truncates it
past 140 characters, and `beside` spends the id's own slashes on directories, so
a path does not decode back to a key. The store answers with names — a thing to
go and look at, never a thing to look up.

**Merging by counting.** A sharded run asks this question once per shard with the
same whole plan, so every shard's report carries the identical sentence and
`merge` collapses them by string identity. Anything that made the sentence
shard-specific — a count of what this shard skipped, the shard's glob — would
turn one fact into N.
