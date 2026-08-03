# ADR-0022 — Deciding is not writing

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0021 (approval promotes an image that already exists)
**Discharges:** spec 0010, access half

## Context

The history service has one bearer token, and one is right for it: everything it
holds was posted by the operator's own runs, and the token is not *who are you*
but *is this write attributable to this deployment at all*.

A deployment that also holds a review surface is not that. ADR-0021 makes
approving a **promotion of a baseline** — the artifact every future run is
compared against. So the deployment now has two populations of caller doing two
different things:

- **CI**, which posts builds, baselines and history rows, and whose credential is
  written into a workflow file, read by every job, and printed by anything that
  dumps its environment on failure.
- **A person**, who decides, and whose decision changes what the next run means.

One token spanning both is not a smaller version of two. It means anything that
can read a build log can approve a regression, and the approval will carry
whatever name it chose to send. There is no audit trail to lose, because there
was never a distinction to record.

The tempting middle position is one token plus a claim in the request — a role, a
scope, a header the caller sets. That is not a second secret; it is the first
secret asking the caller what it is allowed to do.

## Decision

**Two secrets. Ingest writes; review decides. They may not be the same value, and
construction refuses it.**

- `ingestToken` — builds, baselines, the render cache, history rows. The one that
  lives in CI.
- `reviewToken` — reading the review surface, its images, deciding, and sweeping.

Both are refused below 16 characters, and two equal values are refused outright:
a deployment that set both to one string would satisfy every check in the router
while having exactly one secret, and **nothing in any request would show it**.

**Authentication happens before routing.** A caller holding neither token gets one
sentence — identical for a missing token, a wrong token, and a path that does not
exist. The alternative, 404 for unknown paths and 401 for known ones, hands an
unauthorised caller a map of the API, and on a subject-scoped path it answers
"that subject exists" to somebody holding nothing.

**The capability check happens after routing, and says which token a route
wants.** It is reachable only by someone already holding a valid token, so naming
the other one reveals nothing they could not learn by trying it — and a caller who
gets 403 with a reason fixes their configuration, where one who gets 404 goes
looking for a typo in a path that is correct.

**A refusal to carry out a decision is not a platform failure.** Approving a
subject with no candidate answers 422 and not 500. A dashboard that showed
"Cloudflare is unreachable" for a reviewer who clicked the wrong button sends
somebody to the wrong page.

## Consequences

**The tokens cannot reach a browser, so something else has to be the gate
there.** A review token in a page is a review token in everybody's devtools, and
this one promotes baselines. So the mounting adapter keeps both on the server and
attaches one per request — which makes the *adapter*, not the token, the gate,
and pushes the question onto the operator's own session.

`createVarianceRoutes` therefore takes an `authorize` hook with **no default**.
Defaulting it to "review" would publish an approve button to the internet, and a
package that shipped that as a convenience would be shipping the failure. An
operator who genuinely wants an open surface writes `() => 'review'` in their own
file, where the next person reading that repository can see it. The adapter also
*replaces* any `authorization` header the caller sent rather than passing it
through, because a caller that can name its own capability makes `authorize`
advisory.

**Neither token is a person.** There are no accounts, no roles and no identity
here; the reviewer's name on a decision is a string the caller supplied. That is
sufficient for the deployment shape this is — one team, one project, one operator
— and it is the first thing that would have to change for any other.

**One deployment still serves several projects**, because every row and object key
is scoped by project. The tokens are not: a token is per deployment, so two
projects that must not see each other's baselines are two deployments.
