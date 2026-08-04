# ADR-0023 — A service is named for what it is, and depends on what it needs

**Status:** accepted
**Date:** 2026-08-03
**Amends:** ADR-0013 (packages are named for their requirements)
**Discharges:** spec 0010, packaging half

## Context

ADR-0013 makes every package name its requirements and pay for nothing else: a
consumer who wants the store contract does not get a filesystem, and one who
wants the pixel tier does not get a browser. The rule has been applied to
fourteen packages without an exception.

The review backend is the first thing here that is not a **tool**. Its
entrypoints have genuinely different requirements — `/worker` needs D1 and R2,
`/ui` needs React, `/testing` needs Node 22 — and the reflex is to split it, or
to reach for optional peer dependencies, so that a Worker-only operator does not
install React.

That reflex is ADR-0013 applied past the argument that justifies it. The rule
exists because a tool is **linked into somebody else's build**, and one that drags
a browser or a socket in behind their back has decided something for them that
they now have to pay for and did not ask for. A service is linked into nothing.
It is deployed, once, by the operator who chose it — there is no third party
whose build acquires a requirement, and no consumer to protect from one. Slimming
its install optimises a cost nobody pays, and it fragments the single thing the
operator was told to wire up once.

**The same confusion produced its first name.** It shipped as
`@variance-authority/cloudflare`, which names a *host* — and ADR-0013 names
packages for their requirements precisely because a name that describes the
environment tells a reader nothing about the thing. Worse, the name was not even
accurate: the bindings are structural, the router speaks Web-standard `Request`
and `Response`, and the SQL runs against `node:sqlite` in every test. Nothing in
the package is Cloudflare-specific. A name that pins a service to one host both
misdescribes it and quietly discourages running it anywhere else.

The same question arrives from the other side with `@cloudflare/workers-types`.
Depending on it would be the obvious move — it is the platform this thing is
named for — and it is the one to refuse, for a reason that has nothing to do with
install size: it is an ambient global declaration, so it would land in the build
of every package that links this one, and, decisively, it would make the store
untestable anywhere but a Workers runtime.

## Decision

**A service is named for what it is. Never for where it runs.**

So the package is `@variance-authority/tribunal`: the venue where evidence is
held and a verdict is reviewed and settled. It sits under *Variance Authority* as
a sibling institution, and it leaves `docket` free for what the surface renders —
the list of causes awaiting a decision, which is already what the code calls it.
The tribunal holds the docket.

Cloudflare stays in the prose, where a deployment target belongs, and does not
appear in the package name, the entrypoints, or any exported symbol. Where a
symbol names the engine it does so because the engine is what it *is* —
`createD1Backend` beside `server`'s `createSqliteBackend` — and where it names how
bytes are kept it joins the existing series: `createBucketStore` beside
`createDurableStore`, `createLfsStore` and `createRemoteStore`.

**A service's dependencies are chosen for what serving needs. A tool's are chosen
for what a consumer would be forced to install. ADR-0013 governs the second.**

So the package declares React as an ordinary production dependency, though only
`/ui` and `/next` touch it, and it does **not** declare
`@cloudflare/workers-types`, though `/worker` runs on the platform it describes.
Those look opposite and follow from one rule.

**The platform is declared here, structurally, as the subset actually used.**
Five methods on D1, four on R2 — written out in one file that imports nothing.
The real `D1Database` and `R2Bucket` satisfy it because a wider interface is
assignable to a narrower one, so an operator passes `env.DB` and `env.BUCKET`
straight in with no cast.

**The entrypoint table stays, and its job changes.** It says which entrypoint
needs what, for someone reading the code or splitting a deployment across two
Workers — not to let anyone install less of it.

## Consequences

**The store is testable in a plain `vitest` process**, with no `wrangler`, no
container and no account, and that is the whole return on refusing the platform
types. D1 *is* SQLite, so the exported double runs the real statements through
`node:sqlite`: the schema, the indexes, the append-only triggers, the `ON
CONFLICT` clause and every `ORDER BY` execute rather than being paraphrased. It is
also what lets the store join `packages/observe/src/parity.test.ts` as a fourth
backend, which is the only thing that makes ADR-0016's claim true of it.

**A change to D1's or R2's own API is a runtime failure here, not a compile
error.** That is the price, and it is bounded by keeping the declared surface
tiny — nine methods, all of them years old, all of them exercised by the double
on every run.

**The boundary gate reads dependencies per package, not per entrypoint**, so
`tools/boundaries.check.ts` requires React in `dependencies` for `/ui` to import
it. Under this ADR that is the correct answer rather than a limitation worked
around: the declaration is honest, and the gate is enforcing the honest thing.

**"Is this a tool or a service?" is now a question with consequences**, and it is
answered by whether anything links it. Everything else in `packages/` is a tool.
If a second service appears, it inherits this rule and not ADR-0013's.

**The service is portable and nothing here proves it.** Cloudflare is the only
host it has been written against, and it has not run on that one either. What the
name now claims is narrower than "runs anywhere": it claims the package is not
*about* Cloudflare, which the structural bindings and the `node:sqlite` double
already make true. A second host would be the measurement.
