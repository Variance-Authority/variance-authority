# The sitemap and the component were never connected

A draft claimed a route suite narrows on `--since`, and the reading it got back
was that this is impossible: a sitemap points at URLs, nothing connects a URL to
a component, and the only thing in this system that could is a journey. Both
halves of that are worth writing down, because one is right and the other is
right about the wrong mechanism.

## Routes genuinely have no journal

`drainExecution` has two non-test callers — `storybook-collector/src/execution.ts`
and `playwright-test/src/execution.ts`. `route-collector` never drains, and
nothing splices probes into a served application's bundle. So a route subject
has no execution record, and the journal ground in `run-select.ts` never applies
to one. The objection was correct about routes and correct about journeys.

## The link is the baseline, and it is empirical

It is also not the mechanism `--since` uses. The structural ground in
`affected.ts` reads the *baseline*: an approved sidecar records the component
names that page's last approved render actually produced (ADR-0018, ADR-0027),
and `describe` hands back that list without the image. Narrowing intersects it
with the components the diff reaches.

Nothing is inferred from the URL. Nothing is crawled, no bundler graph is
consulted, no plugin is installed. The connection between `/blog` and `BlogCard`
is a fact the run *observed* the last time somebody approved that page, and it
is available to a route suite for exactly the same reason it is available to a
Storybook one: both end in a rendered document.

The journey ground, where it exists, only ever removes, and only from what the
structural ground already kept. Routes simply never reach it.

## Nothing in the repository exercised it

`examples/` and `cases/` contained no use of `routeCollector` at all, so the
claim had no reproduction anywhere. Built one: a three-page React site, esbuild
with `keepNames` and no minification, a `sitemap.xml`, and a `variance.config.json`
with `source: { dirs: ['src'] }`.

First run: `6 component(s) across 3 subject(s) — About, Blog, BlogCard, Home,
PageHeading, SiteFooter`. The accepted sidecar for `blog.html` carries
`components: ["Blog","BlogCard","PageHeading","SiteFooter"]`. So the link exists
on disk, for a subject discovered from a sitemap, with no journey anywhere.

**Selection is file-level, and the first attempt proved it the hard way.** The
first narrowing test edited a file declaring three components and ran all three
pages — correctly. Splitting `BlogCard` into its own file narrowed 3 → 1:

```
1 of 3 subject(s) observed — 1 changed, 2 not observed
  [unreached] home.html: not affected by the diff against mainline: its baseline
              records 3 components and this diff touched none of them (BlogCard)
```

The draft said "a component two pages use". The mechanism charges every
component a *changed file declares*, so the sentence had to become "a file
declaring one component that two pages reach". A blunt unit, correctly
described, beats a precise one that is not what runs.

## New routes are safe; removed ones were not

Adding `contact` to the page list while the diff touched only `BlogCard`:

```
2 of 4 subject(s) observed — 1 changed, 1 new, 2 not observed
  [new] contact.html: no baseline for `contact.html` under this renderer
```

exit 1. Narrowing cannot hide a page nobody has approved.

Dropping pages from the sitemap:

```
2 subject(s) observed — 2 unchanged
coverage: every planned subject was observed.
exit=0
```

`baselines/v1:.../blog.html.png` still on disk, unwatched, and the only thing
said about it was a generic warning that a page dropped from the sitemap "stops
being watched, and nothing here will say so" — which does not say *which*. The
run knew the ids it planned and the store knew the ids it held, and the
difference was never taken. ADR-0063 takes it.
