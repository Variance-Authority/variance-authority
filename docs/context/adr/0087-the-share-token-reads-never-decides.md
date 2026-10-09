# ADR-0087 — the share token reads, never decides

**Status:** accepted
**Date:** 2026-10-09
**Extends:** [ADR-0022](0022-deciding-is-not-writing.md) (deciding is not writing)
**Relates to:**
[`packages/tribunal/src/worker-auth.ts`](../../../packages/tribunal/src/worker-auth.ts),
[`packages/tribunal/src/worker-attested.ts`](../../../packages/tribunal/src/worker-attested.ts),
[`packages/cli/src/commands/attested.ts`](../../../packages/cli/src/commands/attested.ts)

## Context

ADR-0022 split a deployment's callers in two: CI writes with the ingest token,
a person decides with the review token. The share token came later, as a third
secret for machines that read the lines under `/share/` and must not write them.

What reviewers settled — the changelog of approved baselines and the history of
every decision — was served to the review token alone. Two readers asked for it
and held neither token they could be given:

- **An agent** working in a checkout, asking whether the change in front of it
  was already approved, by whom, and why. Handing it the review token hands it
  the approve button.
- **`variance changelog` on a remote store.** Its history is not in git, it is
  in the deployment, and the command refused rather than read it.

Both readers already hold the share token, or can be given one, because that is
the token a developer's machine reads a share with.

## Decision

**The share token reads what review settled, and never decides.**

- `attested()` admits the review token and the share token, and refuses the
  ingest token. It guards `GET /review/changelog` and `GET /review/decisions`
  and nothing that writes.
- A route that writes a decision or a concern keeps `requires(granted,
  'review')`, so the share token reaching it is a 403, as before.
- `GET /review/decisions` names a build, a subject or both, and reads at most
  200 decisions; `GET /review/changelog` reads at most 500 approvals. A token
  that sits on laptops and in agents does not page through a project's whole
  review history with one request.
- The read routes check the token before the method, so a share token sending a
  `POST` to them gets 405: the path is one it may read, and the method is one no
  token may use there.

**The ingest token is excluded, though it may read history.** CI holds it, it is
the token most likely to leak through a build log, and CI commonly sets
`VARIANCE_SHARE_TOKEN` to it. Refusing it with a 403 that names the share token
turns that misconfiguration into a sentence instead of a silent read.

**The documentation declares the share token through the environment.** The
CLI and the MCP server take it from the `share` declaration, and every example
shows `{ "env": "VARIANCE_SHARE_TOKEN" }`. A literal in a committed config file
is a token in every clone.

**The API version moves to 4**, because a CLI reading through these routes
against a deployment at 3 gets a 403 or a 404 and has to say why.

## Consequences

- A route that reads and writes on one path, as concerns do, stays in its own
  module: its `GET` branch calls `attested()` in place of `requires(granted,
  'review')`, and its write keeps the review token. It does not join
  `worker-attested.ts`, which refuses every method but `GET`.
- An agent can be given read access to review without any path to approve, and
  nothing about who may decide changed. The exception is a Node deployment bound
  to loopback, which grants `review` to a request with no token: an agent on that
  machine decides by sending none, as it could before.
- A share token handed out before API 4 reads reviewer names and notes once the
  deployment is redeployed. There is no setting to withhold it; an operator who
  does not want an existing holder to read them rotates the share token first.
- Only a share stored at the deployment supplies the token that reads it. A
  project whose share is kept in S3 or on disk, with its baselines on a
  Tribunal, reads nothing here until it moves its share to the deployment.
- `variance changelog --since` takes an instant against a remote store, and a
  revision against a git store, because a deployment records when, not which
  commit.
- `declaredSecret` still accepts a literal share token. Refusing it is a
  separate change, because it would refuse configurations that work today.
