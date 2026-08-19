# ADR-0043 — An extension does not own its host

**Status:** accepted
**Date:** 2026-08-19
**Amends:** ADR-0024 (a consumer knows one package)

## Context

ADR-0024 limited adopter-facing code to one Variance Authority package. That
kept collaborators out of consumer imports, but it did not constrain which
symbols the surface took from the framework it served.

`@variance-authority/playwright-test` exported an extended `test` and `expect`.
Its shortest example therefore replaced the two imports at the centre of every
Playwright suite. A suite with its own fixtures, matcher extensions, wrapper, or
import convention could not add one observation; it had to make this package the
new owner of its test surface and then compose its existing work back into it.
One package was visible, so ADR-0024's check passed while the adoption boundary
was still wrong.

Storybook supplies the contrast. The Storybook collector reads `index.json` and
drives the preview channel of a built or served artifact. It does not read or
write `.storybook`, replace a renderer, or become the command that builds the
artifact. The integration owns only the observation it contributes.

## Decision

**An extension never exports replacements for the host's control primitives.**
The adopter keeps the imports, configuration, lifecycle, and composition point
that already own the framework.

For Playwright:

- `@variance-authority/playwright-test` exports neither `test` nor `expect`;
- `observe(page, locator, testInfo)` is the additive, one-observation path;
- `createVariance(page, testInfo)` holds a renderer across several observations
  and exposes an explicit `close()`;
- `assertUnchanged(observation)` is a plain assertion, so a suite need not
  replace or extend its `expect`;
- `varianceFixtures` and `varianceMatchers` are unbound parts for a suite that
  already owns a shared extension module; and
- `@playwright/test` is a peer, because installing an extension must not install
  a second copy of its host.

For artifact adapters, the common path consumes what the host already produces.
The Storybook collector takes a built or served Storybook and its `index.json`;
the route collector takes a served application or static directory. Optional
source-location instrumentation may improve a production report, but it is not
a prerequisite for observation and cannot be presented as one.

The boundary is enforced at the exported Playwright surface and in compiled
README examples: `test` and `expect` come from `@playwright/test`, while only the
observation and assertion come from Variance Authority.

## Consequences

**The one-shot path pays for isolation.** `observe` creates and closes a renderer
for one call. A test with several subjects uses `createVariance`, or an existing
shared fixture layer composes `varianceFixtures`, so the browser lifetime is an
explicit choice owned by the suite rather than hidden in package state.

**Fixture convenience is no longer the default API.** Playwright fixtures remain
available as values and types, but there is no package-owned runner through which
all tests must pass. The shortest call is slightly more explicit: it names the
page and `TestInfo` the existing test already has.

**The change is intentionally breaking.** No release exists whose callers need a
compatibility alias, and retaining `test` or `expect` would preserve the exact
ownership error this decision removes.

**An additive adapter may still add a workflow.** Baselines, reports, acceptance,
and a CI exit code belong to this product. The constraint is that those steps run
beside the host's build or test process; they do not require the host to route its
own control surface through this package.
