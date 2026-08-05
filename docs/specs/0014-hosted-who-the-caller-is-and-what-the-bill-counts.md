# 0014 — Hosted: who the caller is, and what the bill counts

Rung D of [`flows.md`](../flows.md#the-other-machine-question-where-the-renderer-runs):
*somebody else's, hosted*. It does not exist, and the first customer is us.

That framing is the whole of why this spec is short. The target is not a launch —
it is **the smallest deployment we can run for ourselves without designing
ourselves into a rewrite the day a second project appears.** Almost everything
here is already built and single-tenant; what is missing is two decisions that
cost nothing today and cost a migration later.

**Rendering is deliberately not in scope.** `flows.md` argues that the renderer
belongs in the CI job that already checked out the code, and a hosted farm is the
last rung rather than the first. What is hosted here is storage, review and
history — the customer keeps painting.

---

## 1. A token grants a capability, and never an identity

`worker-auth.ts` resolves a request to `'ingest' | 'review'`: constant-time
comparison, a 16-character floor, one indistinguishable refusal for a missing
token, a wrong token and an absent route. The capability split is right and is
not what is missing.

What is missing is that a capability is **all** it resolves to.

**Consequence A — one deployment is one project.** No row carries a project, so a
second customer means a second deployment. That is survivable for one tenant and
is a rewrite of every key at two.

**Consequence B — an approval has no approver.** A row records that *somebody
holding the review secret* promoted a baseline. Nobody can be asked about it
afterwards, which is most of what an approval is for.

### The decision to force

Does identity ride **in** the credential, or **beside** it?

```ts
// Option 1 — project-scoped tokens. One lookup, no identity provider.
interface ProjectToken {
  readonly project: string;
  readonly capability: 'ingest' | 'review';
}

// Option 2 — machines carry tokens, people carry sessions.
interface MachineToken {
  readonly project: string;
  /** Only ever this. A machine cannot be granted the other one. */
  readonly capability: 'ingest';
}

interface ReviewerSession {
  readonly project: string;
  /** From an identity provider, so an approval names somebody. */
  readonly subject: string;
}
```

**Recommended: option 2**, and the argument is
[ADR-0022](../context/adr/0022-deciding-is-not-writing.md) rather than a
preference. A machine may write a candidate; only a person may promote one. A CI
token that could approve lets a run bless itself, and a review surface that a run
can satisfy on its own is decoration.

The identity provider should be GitHub, because the reviewer is already the pull
request's reviewer and no password is then stored anywhere.

**The rule to carry forward:** the ingest capability must be *incapable* of
approval rather than merely unauthorized for it. Today's two-token split already
says this. It has to survive tenancy, which is exactly the kind of property that
does not survive a migration written in a hurry.

---

## 2. Nothing counts anything — and a counter is the wrong shape

There is no metering, and the obvious fix is the wrong one.

[ADR-0020](../context/adr/0020-read-the-artifact-not-the-configuration.md) says
read the artifact, not the configuration. A bill computed from a counter we
increment is a number the customer cannot check, and disputing it means asking us
to re-read our own log.

**The rule: the bill must be derivable by listing what is stored.** A customer
counts their own invoice. `variance doctor` already enumerates baselines by
identity — the same walk, run by them, must produce the same figure we charge.
Anything that cannot be recomputed from the stored artifacts cannot be billed
for.

---

## 3. A price that does not undo the architecture

The category bills per screenshot: **$0.036** on Percy, **$0.008** on Chromatic,
**$0.004** on Argos ([comparison §1](../comparison.md#1-the-dimensions-a-buyer-actually-decides-on)).
That is honest about their costs — a browser produces the whole observation
there, so every subject is a paint, an upload and a decode.

It is not honest about ours. A subject that did not change settles from a few
hundred bytes of sidecar beside the image and **never uploads, never decodes and
never diffs** — `settle` is the argument, and on a normal pull request roughly
two subjects in three hundred reach a paint at all. Charging per screenshot
prices a cost we do not have.

The stronger objection is not that it overcharges. **A price is a rule about
behaviour.** Per-screenshot pricing teaches a team to cover less, which is
precisely the choice the tier ladder exists to make unnecessary. Pricing that way
would spend the architecture to look like the competition.

### Proposed unit

**Stored baselines, and the retention window. Runs, subjects, viewports and
comparisons are free.**

That sentence is true here and impossible for a vendor whose unit is the
screenshot, and it falls out of the design rather than being a promotion. What we
actually pay for is bytes that persist — baseline images in a bucket, history
rows in a database, egress on the images that genuinely move.

A free tier of one project, a small baseline cap and a 30-day history window
costs us kilobytes per unchanged run, which is what an unchanged run *is*.

**Open**: whether the retention window is priced or fixed per tier, and whether
`ephemeral` retention — which stores nothing at all — is therefore free forever.
The second is a real question, because it is a complete deployment that consumes
no storage and would be the honest answer for a large class of teams.

---

## 4. `serveRenderer` has no authentication

Stated because it is a hole rather than a decision. `serveRenderer` takes no
token, which is why the CLI's `renderer` config field deliberately has none
either. A hosted renderer without authentication is an open browser somebody else
pays for.

Last rather than first: per `flows.md` the renderer should stay in the customer's
CI, so nothing above depends on closing this.

---

## What would discharge this spec

1. Decide option 1 or option 2 above, and write the ADR.
2. **Put a project on every row now**, while there is one project. Adding the
   column later is a migration; assuming it away is a rewrite. This is the single
   item that must land before the first self-hosted deployment rather than after.
3. Make approval require a named subject, and make the ingest capability unable
   to reach it.
4. Implement metering as a walk over stored artifacts, and publish the walk so a
   customer can run it.
5. Give `serveRenderer` a bearer token, and the CLI's `renderer` config the field
   it has been missing.

Items 1 and 2 are what "start using it ourselves" actually requires. Items 3
through 5 are what a second tenant requires, and none of them is hard once 2 is
true.
