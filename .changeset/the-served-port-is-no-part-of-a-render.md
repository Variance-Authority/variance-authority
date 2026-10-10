---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/playwright': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
---

The port a build is served on is no part of a render, and every stored baseline is invalidated

The route and Storybook collectors serve a build on a free port, and that port
reached two identities. An asset the page loaded was keyed by its absolute URL,
and a `url()` in a computed style was the absolute URL the engine resolved. One
build served twice therefore read as two renders with two style hashes, and a
subject compared against its own baseline as changed.

An asset the page's own origin serves is keyed by its path, and the page's
origin is dropped from a `url()` before it is hashed. An asset another origin
serves keeps its absolute URL. A capture carries the page's `baseUrl` so core
knows which origin is the page's, and the renderer resolves a path-keyed asset
against the document's `baseUrl`.

**Every stored baseline is invalidated.** `RULESET_VERSION` moves from `r1` to
`r2`, and the ruleset version is part of the environment key, so every subject
recorded under `r1` reads as `incomparable` on its first run under `r2`. Run
once and accept the result to record baselines under `r2`.
