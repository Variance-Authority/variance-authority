---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/playwright': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/unit-test': patch
'@variance-authority/vitest-browser': patch
---

The port a build is served on is no part of a render

The route and Storybook collectors serve a build on a free port, and that port
reached two identities. An asset the page loaded was keyed by its absolute URL,
and a `url()` in a computed style was the absolute URL the engine resolved. One
build served twice therefore read as two renders with two style hashes, and a
subject compared against its own baseline as changed.

An asset the page's own origin serves is keyed by its path, and the page's
origin is dropped from a `url()` before it is hashed. An asset another origin
serves keeps its absolute URL. A capture carries the page's `baseUrl` so core
knows which origin is the page's, and the renderer resolves a path-keyed asset
against the document's `baseUrl`. `documentDigest` reads the page's own base
and resources as paths, so one build served on two ports addresses one render
and the render cache hits; the document keeps them absolute for the renderer,
and a resource another origin serves stays absolute in the digest too.

A `@variance-authority/unit-test` capture keys its assets the same way, so a
`@variance-authority/vitest-browser` observation, which captures through it on
the port the runner had free, keeps the port out of its environment key.
`readCapture` reads back a capture whose asset is keyed by path, resolving the
key against the document's `baseUrl` as the renderer does; `assetUrl` in
`@variance-authority/core/format` is that one resolution.

**The document of every page served over `http` moves once after this
upgrade.** `documentDigest` now reads a document's base and resources without
the page's origin, so the digest of every document served over `http` or
`https` changes: every route, every story, every Vitest browser page, and every
Playwright page opened by URL. A moved document misses the render cache once,
and its image is still compared with the baseline: a page whose pixels did not
move reads `unchanged`, and one whose pixels did reads `changed`, which
`variance accept --all` and Playwright's `--update-snapshots=changed` adopt.
`RULESET_VERSION` moves from `r1` to `r2`. The ruleset is part of a snapshot's
environment key, not of the render recipe, so no image reads `incomparable` for
it; a snapshot diffed against one recorded under `r1` names the ruleset as its
environment root.
