# Spec 0021 — Tribunal on a real deployment

**Missing:** the deployment. The service implements the baseline store, the
history backend, the build-and-approve model and the review surface, and has
never run on Cloudflare.
**Built on:** [ADR-0021](../context/adr/0021-approval-promotes-an-image-that-already-exists.md),
[ADR-0022](../context/adr/0022-deciding-is-not-writing.md) and
[ADR-0023](../context/adr/0023-a-service-is-named-for-what-it-is.md). D1 is
SQLite, so the tests execute the real SQL through `node:sqlite` against an
in-memory bucket.

## Purpose

The tests verify the queries, the triggers, the promotion path and the routes.
What they cannot verify is the platform, and the platform is most of what a
deployed service is:

- **Batch atomicity.** D1 batches are not `node:sqlite` transactions. A promotion
  that writes a row and moves an object is two systems, and what happens when the
  second fails is unmeasured.
- **Quotas and object-size ceilings.** A baseline is a PNG. The ceiling is a
  number somebody has to hit before it means anything.
- **Concurrent Workers.** The in-memory bucket has one caller. Two reviewers
  approving two subjects of one build at once is the ordinary case and has never
  happened.
- **Cold starts and the migration path.** Migrations are generated at build time
  by [`tools/tribunal-migrations.mjs`](../../tools/tribunal-migrations.mjs) and
  have never been applied to a database that already had rows in it.

## What would discharge it

**One deployment, in an account somebody owns, receiving one build.**

1. Deploy, apply migrations to an empty database, and post a build from a real
   run. Nothing in `packages/cli` posts one today — the ingest route takes a
   build and an operator writes the HTTP call — so this closes that seam or
   documents why it stays open.
2. Approve a subject through the review surface, and observe that approval
   promoting a candidate the run already produced. ADR-0021 is the whole design;
   this is the first time it faces two systems that can fail independently.
3. Apply a second migration to a database with rows, from a Worker that is
   already serving.
4. Provoke the four platform limits above deliberately, and record each number.
   A limit found in production is an incident; a limit found on purpose is a
   configuration value.

## What this spec is not

**It is not identity, and it is not billing.** A token resolves to a capability
and never to who or whose; nothing counts anything. That is
[spec 0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md), and it is
a harder problem than deployment. Deploying first is deliberate: a service nobody
has stood up cannot teach anything about what its tenants need.

## Standing constraint this must not weaken

**The cheap path stays cheap.** Every capability here has to degrade to a working
single-run tool with no backend at all, and report the absence rather than
defaulting to a silent negative. A tribunal that becomes required is a different
product.

## Leaves behind

An ADR on what the deployment boundary owns — migrations, quotas, and which
failures are the operator's to configure rather than the code's to handle.
