<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/vitest-browser

> Observe a component against its baseline from inside a Vitest browser-mode test, without leaving the test body.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

Your component test in Vitest browser mode has already mounted the component in
a real engine with the real stylesheets, and the locator it awaited is proof the
thing arrived. Add one call to that test and you get a second answer out of the
same mount: whether this render still matches the image you approved, and — when
it does not — which components drew the pixels that moved and the `file:line`
each was written at.

A **subject** is one named UI state you asked for and can ask for again, such as
`cart/empty` or `save-button/disabled`. Each subject has exactly one baseline:
the last image of it that a person approved.

```tsx
test('save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container, { subjectId: 'save-button/disabled' }));
});
```

Your existing `toHaveScreenshot` assertions keep working. This does not replace
them and does not read their baselines.

## Where the package comes from

It is not on the npm registry. Every package it depends on is published;
this one is not, so `npm install @variance-authority/vitest-browser` fails. Use
it from a clone of the repository, where it builds and resolves as a workspace
package:

```bash
git clone https://github.com/Variance-Authority/variance-authority.git
cd variance-authority
yarn install
yarn build
```

Everything below describes the package as it behaves once resolved.

## What you need in place

Vitest browser mode must already be running your component tests, and the
locator you would normally assert on must already resolve. Two browsers are in
play: the one your provider mounts components in, and a Chromium the Vitest
process owns and paints baselines with. The second does not arrive with a
package install:

```bash
npx playwright install chromium
```

The example below also uses `vitest-browser-react` to mount
(`npm install --save-dev vitest-browser-react`). Any binding works — `variance`
takes a DOM element or a locator — but component names, `file:line`, framework
wiring and the Suspense guard are read out of the React tree. Mount a Vue or
Svelte component and the image comparison still runs, with regions coming back
unattributed.

## Register the command

A test body in browser mode runs inside an iframe in a tab, and a tab has
neither the baseline directory nor a browser it can launch to paint with.
Vitest's command protocol carries the reading out to the Vitest process, and
`variancePlugin` registers that command. Without it `variance()` throws, naming
the plugin you have to add.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { variancePlugin } from '@variance-authority/vitest-browser/node';

export default defineConfig({
  plugins: [react(), variancePlugin({ baselines: '.variance/baselines' })],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

`baselines` defaults to `.variance/baselines`; the line above is the default
written out. The plugin contributes only the command registration and a hook
that closes the browser at the end of the run, so its position in `plugins` does
not matter.

| option | default | what it decides |
|---|---|---|
| `baselines` | `.variance/baselines` | the directory baselines are stored in |
| `store` | a durable store on `baselines` | an existing store, when baselines do not live in a directory |
| `renderer` | a Playwright renderer opened on first use | an existing renderer, whose lifetime then stays yours |
| `accept` | Vitest's own `--update` | whether this run may promote a candidate to a baseline |

Use `varianceCommands(options)` instead of the plugin when your config already
builds its own command map and wants to decide when the browser closes.

## Add the comparison

```tsx
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import { assertUnchanged, variance } from '@variance-authority/vitest-browser';
import { SaveButton } from './SaveButton';

test('save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container, { subjectId: 'save-button/disabled' }));
});
```

`screen.container` is `vitest-browser-react`'s root element for the mount. If
your binding does not expose one, pass a locator: `variance` accepts any DOM
element, or anything with an `element()` method, which is every browser-mode
locator.

`variance` returns the observation rather than throwing on it, so a test may
read the verdict before deciding what it means. `assertUnchanged` is the usual
decision — it throws the sentence the run would have printed — and
`toBeUnchanged` is the same decision as a matcher function, for a suite that
composes its own `expect`. `variance` itself throws in two cases only: the
subject is still showing a Suspense fallback, and no subject id could be derived
because the call was made outside a test.

`subjectId` identifies one UI state rather than one test, so a test comparing
three states needs three ids, and its uniqueness scope is the baseline directory
rather than the file. Left out, the id is the test's full name — renaming the
test then orphans its baseline and the next run reports `new`, so pass it
explicitly for any baseline you expect to keep.

## Run it and approve the first baseline

```bash
npx vitest run
```

The first run has nothing to compare against, so the assertion fails with:

```
save-button/disabled: new — no baseline for `save-button/disabled` under this renderer; nothing to compare against
```

Approving is the same gesture as approving the snapshots in the same suite:

```bash
npx vitest run -u
```

That promotes the image this run already painted rather than painting a second
one, so the bytes that became the baseline are the bytes the run produced. Open
the PNG it wrote under `.variance/baselines` before you commit it — that review
is the approval. Run the suite again and the subject reports `unchanged`.

Set `accept: false` on the plugin to hold baselines out of `--update`
altogether, or `accept: true` for a job whose whole purpose is to write them.

### Commit the baselines

The baseline directory is ordinary tracked files, and it is how CI finds the
approved state. A run that cannot read what the last run wrote does not fail —
it reports every subject `new`. If your repository ignores `.variance/`, exclude
its contents rather than the directory, so git still descends into it:

```gitignore
.variance/*
!.variance/baselines/
.variance/baselines/**/by-document/
```

The third line keeps the render cache out. A durable store is also a cache keyed
by the digest of the document that produced each image; it gains an entry on
every edit and is worth nothing after the next one.

## Read a failure

There is no HTML report on this path — the message is the report. It opens with
the subject, the verdict and the sentence explaining it, then lists each changed
region with the component that drew it and the `file:line` it was written at:

```
save-button/disabled: changed — 612 pixels differ across 2 regions in Stack, Toggle
2 region(s), ordered by area — no causes were supplied, so this
ordering measures displacement rather than blame:
  511px — Stack
      src/app/cart.tsx:18
  101px — Toggle
      src/app/cart.tsx:42
```

The ordering caveat is printed because it is true: area measures displacement,
so a container pushed by an edit can outrank the edit itself. Regions with no
component behind them are printed as coordinates and marked unattributed. Paths
are made relative to `sourceRoot` when you pass one.

The images are files. The approved baseline is the `.png` under the baseline
directory, beside a `.json` recording what painted it; the candidate this run
painted is in the render cache under `by-document/`, named by the digest of the
document it came from.

## Read the verdict yourself

```ts
const observed = await variance(screen.container, { subjectId: 'save-button/disabled' });

if (observed.verdict === 'new') {
  console.log(observed.message);
} else {
  assertUnchanged(observed);
}
```

There are five verdicts, and `assertUnchanged` throws on all four that are not
`unchanged`, `ignored` included, because it asserts exactly what its name says.

| verdict | what it means |
|---|---|
| `unchanged` | the two images were comparable and no pixels differ |
| `changed` | pixels differ; `regions` names what drew them |
| `new` | no baseline exists for this subject under this renderer identity. Not a pass and not a failure |
| `incomparable` | a baseline exists but a different machine painted it, so the comparison is refused. Never read it as zero difference |
| `ignored` | pixels differ and every one of them fell inside something you excluded |

The observation carries these fields:

| field | what it holds |
|---|---|
| `subject` | the subject id this observation is about |
| `verdict` | one of the five above |
| `because` | one sentence saying what happened and why it has that verdict |
| `message` | the whole formatted failure, regions included — what `assertUnchanged` throws |
| `regions` | changed regions, each with its component, `file:line`, box, pixel count and fingerprint where it has one |
| `rendered` | `false` when the image came from the cache rather than from a paint |
| `missingFonts` | families the document declared that the renderer did not have |
| `signals` | the document and the pixels as separately observed boundaries, plus the accessibility diff when one was read |
| `comparison`, `isolation` | the raw pixel comparison and the region clustering behind `regions` |
| `causes`, `moved` | components whose own hashes differ, and in which band. Absent when either side carries no hashes, which means *unknown* rather than *nothing moved* |
| `ignored` | what your exclusions absorbed here, per rule, including rules that absorbed nothing |
| `relaxed` | the sensitivity that decided this verdict, and the bands it absorbed |
| `diagnostics` | what this comparison could not do, or did under a condition worth stating |

## Options

Every option is the second argument to `variance`.

| option | default | what it decides |
|---|---|---|
| `subjectId` | the running test's full name | what the baseline is stored under |
| `subjectKind` | `'fixture'` | what produced the subject, recorded rather than guessed |
| `fonts` | none | the font stack this machine is asserted to have, as `family/weight/style/hash` — see below |
| `features` | none | environment facts folded into the capture and into media-condition resolution |
| `sourceRoot` | none | the root component paths are made relative to, so `file:line` survives the trip to another machine |
| `suspenseTimeoutMs` | `5000` | how long to wait for the subject's Suspense boundaries before refusing |
| `loading` | `false` | this subject's *loading* state is the thing being captured |
| `wiring` | `true` | read each node's framework wiring — hook names, wrappers, contexts, keys — into the reading |
| `holdings` | `false` | read what each boundary was handed and retained, as digests beside the reading |
| `sensitivity` | none | `{ rule, reason, level }`, where `level` is `'strict'`, `'layout'` or `'content'` — which bands this subject is still asserted on |

### About `fonts`

Leave it out unless you are pinning a font stack. It is a declaration, not a
measurement: a page can ask whether `Inter` resolves and can never read the
bytes behind it, so nothing observable from inside the tab can produce this
value for you.

Only the family — everything before the first `/` — is used to ask the renderer
whether it has the font, and what it could not find comes back in
`missingFonts`. The weight, style and hash are folded into the renderer identity
and compared for equality, never parsed, so any stable digest of the font file's
bytes serves as the hash. What the declaration buys is that two machines
carrying different cuts of one family produce different identities and report
`incomparable` instead of blaming a component for a substituted typeface.

### About `wiring`

Splitting one `useState` into two changes this reading, and it does not make
your subject `changed`. The verdict on this path comes from the two images:
either pixels differ or they do not. The per-component hashes stored beside a
baseline — the ones that let a later run rank a region by which component's own
content moved — are built from structure, semantics, text, style and geometry,
and wiring is deliberately not among them. A component that gained a `memo()`
renders the same thing, and folding the annotation into the content hashes would
make a performance change read as a visual regression and re-baseline every
subject the first time the reading was switched on.

What wiring buys is the record: hook shape, the `memo`/`forwardRef` chain around
a component, the contexts it subscribes to and its reconciliation key, carried
as their own band, so that two subjects agreeing on every content band and
disagreeing here remain distinguishable. Hook names are recorded only by React
development builds; against a production build the field is absent rather than
empty, because "declares no hooks" and "nobody could read the hooks" are
different claims.

Set `wiring: false` to skip the read. `holdings` is separate and off by default
because it changes what a structure hash is — a node carrying a holding
suppresses the inert-wrapper collapse — so both sides of a comparison have to be
read the same way.

## A subject that had not arrived yet

A subject still showing a Suspense fallback is refused rather than captured. The
locator assertion above it passes against a skeleton, and a baseline taken over
a skeleton records the wrong state: a slower machine records the skeleton, a
faster one records the content, and the next run reports the difference as a
regression. The refusal names the boundary and the component holding it.

When the skeleton is the subject, declare it:

```ts
assertUnchanged(await variance(screen.container, { subjectId: 'cart/loading', loading: true }));
```

The declaration is symmetric — a subject declared loading that then settles is
refused too, because a declaration nobody deleted would otherwise record
whichever state the machine's speed produced.

Media queries resolve against the iframe the test body runs in rather than the
browser tab, because that is the frame the component was laid out in. Animation,
caret blink and scroll position are held still before the reading, and what held
them is recorded in it, so two runs that stabilized differently are not silently
compared.

## The two halves, and why the tab's screenshot is not used

The tab reads the subject: markup, the CSS that applies to it, the component
chain behind each node, and the bytes of every resource it references, fetched
with the page's own `fetch` against the server that served them. A response the
server refuses is recorded as absent rather than throwing, because a fixture
pointing an `<img>` at a path nobody serves is testing the fallback.

`@variance-authority/vitest-browser/node` is the other half, and the entrypoint
your Vitest config imports. It holds the baseline store and one browser for the
whole run — opened on the first observation, not at config time — and it paints
that reading rather than screenshotting the tab. A live screenshot has nothing
behind it that can say which machine, which scale and which font stack produced
it, so nothing can decide whether a later run is entitled to compare against it.

The consequence is that a baseline approved on your laptop is usually not
comparable on a CI runner. That run says `incomparable` and names both
identities rather than reporting a day of changed pixels nobody caused. Two ways
to get a verdict instead: approve with `-u` inside the CI image and commit what
it wrote, or pass one shared `renderer` to the plugin so laptop and CI paint on
the same machine.

Full walkthrough:
[add one baseline comparison to a Vitest browser-mode test](https://variance-authority.dev/docs/start-vitest-browser).
How a region resolves to a component and a line:
[attribution](https://variance-authority.dev/docs/attribution). Where the bytes
live: [baseline placement](https://variance-authority.dev/docs/placement).

---

**[@variance-authority/vitest-browser](https://variance-authority.dev/reference/packages/vitest-browser)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
