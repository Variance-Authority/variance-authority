# @variance-authority/route-collector

**Requires:** a browser binary on the machine, and an application already serving
the pages you name. Nothing is built, bundled or mounted here.

```bash
npx playwright install chromium
```

The cheapest surface in the project, and the one that finally uses
`subjects.kind: "list"`.

## Why a route is the cheapest mount there is

`variance run` declines to write the mounting half because a project's components
need its own bundle, its own providers and its own definition of settled. A route
is the case where all three are already true before anything here runs: **the
application served the page.** There is no bundle to reproduce and no provider
tree to rebuild, and readiness is a selector the page itself attaches.

## Usage

```js
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: {
    'checkout/empty': 'http://localhost:3000/checkout',
    'checkout/one-item': 'http://localhost:3000/checkout?items=1',
  },
  roots: ['#app'],
  ready: { 'checkout/one-item': '[data-testid="cart-ready"]' },
  source: { dirs: ['src'] },
});
```

The config names this module, and the ids must match `subjects.ids`:

```json
{
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty", "checkout/one-item"],
    "collector": "collector/index.mjs"
  }
}
```

An id in the plan with no route here is **reported**, not dropped — a run that
observes 29 of 30 subjects and says nothing about the 30th is the silence this
project refuses.

## The arm that was advertised and undemonstrated

`subjects.kind: "list"` has parsed, planned and been unit-tested since the config
existed, and until this package no real suite had ever entered through it —
which [`surface.md`](../../docs/surface.md) called *"the reverse of the usual
failure and still a failure"*. This is what enters through it.

## Bound the subject

`roots` defaults to `body`, which is the caller saying the page *is* the subject.
Naming something tighter is usually right: a shared header inside every subject
means every page moves when the nav does, and the pruning ratio this project
rests on — 1007 rules parsed, 1 reaching the normalizer — is a property of a
**bounded** subject.

## What it is not

**Not a crawler, and not a sitemap reader.** The routes are a map the operator
writes, because a discovered URL is a subject nobody chose: a crawl that finds
one more page on Tuesday reports a `new` subject that no one can approve and no
one asked for. Percy's no-code URL list is the nearest comparable thing and it is
genuinely less work — the difference is who decides what is under test.

**Not one navigation per run.** A Storybook switches stories over its own channel
and pays for one navigation; a route run navigates per subject, because that is
what a route is. The page agent is reinstalled after each navigation and its
presence checked rather than assumed.

## What it cannot do yet

- **Rank causes above collateral.** A durable baseline is an image with no
  document behind it, so no previous snapshot exists to name the roots of a
  change and the docket falls back to area — which measures displacement, and
  which this project measured as backwards by 6×.
- **Authenticate.** There is no cookie, header or storage-state option, so a
  route behind a login is out of reach until the harness grows one.
