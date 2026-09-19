<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook

> Storybook index parsing, subject planning and a host-neutral preview driver.

Part of [Variance Authority](https://variance-authority.dev).

## What this is, and whether you want it

This package turns a built Storybook's `index.json` into an ordered list of
subjects — a *subject* is one named UI state you asked for and can ask for
again, such as `cart/empty`; here, one story — and drives a preview page that
somebody else opened. It launches no browser, captures no pixels, and reads no
`.storybook/` configuration.

**If you want to compare your stories against approved screenshots, this is not
the package to install.** Install
[`@variance-authority/storybook-collector`](https://variance-authority.dev/reference/packages/storybook-collector)
with the CLI instead: it owns the browser, the capture and the run, and depends
on this package underneath. Come here when you are writing that layer yourself —
a custom integration that already owns the page, or a tool that only needs the
story list.

```bash
npm install --save-dev @variance-authority/storybook
```

## Read an index and plan a run

Build your Storybook first (`storybook build`); the index is the `index.json` the
build writes into its output directory, next to `iframe.html`. A running dev
server serves the same file at `/index.json`.

```js
// plan.mjs — node plan.mjs
import { readStoryIndex } from '@variance-authority/storybook/read';
import { toSubjects } from '@variance-authority/storybook';

const index = await readStoryIndex('storybook-static/index.json');
const plan = toSubjects(index, { excludeTags: ['skip-visual'] });

console.log(JSON.stringify(plan, null, 2));
```

`plan.subjects` is sorted by title, then name, then story id — not by the index's
key order, which is whatever the builder's file walk produced. Each entry pairs
the subject key a baseline is stored under with the raw index entry:

```json
{
  "subject": {
    "id": "story:components-alert--danger",
    "kind": "story",
    "title": "Components/Alert/Danger"
  },
  "story": {
    "id": "components-alert--danger",
    "title": "Components/Alert",
    "name": "Danger",
    "importPath": "./src/components/Alert.stories.tsx",
    "componentPath": "./src/components/Alert.tsx",
    "tags": ["dev", "test", "animated"]
  }
}
```

Stories the run will not observe are not dropped. They arrive in
`plan.excluded`, each with the sentence that explains it, so a report can state
every skip:

```json
[
  {
    "id": "components-button--docs",
    "reason": "a docs entry (`type: \"docs\"`): prose about a component, not a render of one"
  }
]
```

`plan.warnings` lists anything the parser read but wants to flag — an index
version it was not written against, a file declaring no `v`, a file with
both `entries` and `stories`.

`parseStoryIndex` is the same parser without the `readFile`, for an index you
fetched over HTTP or already have as a value. The `/read` entrypoint is the only
thing in this package that touches a filesystem.

## Drive a preview page you own

`collectStories` takes an already-open preview from story to story over
Storybook's `postMessage` channel — the same `setCurrentStory` the manager
sidebar sends — instead of reloading for each one. N stories cost one
navigation.

It takes a page object with `url()`, `goto(url, options?)` and
`evaluate(fn, argument)`. No `Page` type is imported here, so nothing in this
package pulls a browser into your dependency tree. A raw Playwright page
satisfies the shape; wrap it with `harnessPage`.

This script runs against a Storybook served at `http://localhost:6006`. It needs
Playwright, which this package does not depend on:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

```js
// collect.mjs — node collect.mjs
import { chromium } from 'playwright';
import { collectStories, harnessPage } from '@variance-authority/storybook';

const browser = await chromium.launch();
const page = await browser.newPage();

const outcomes = await collectStories(
  harnessPage({ page }),
  ['components-button--primary', 'components-alert--danger'],
  {
    baseUrl: 'http://localhost:6006',
    observe: async (outcome) => {
      await page.screenshot({ path: `${outcome.storyId}.png` });
    },
  },
);

console.log(JSON.stringify(outcomes, null, 2));
await browser.close();
```

One outcome per story id you asked for, in your order. A story that throws is an
outcome, not an exception — the remaining stories are still shown:

```json
[
  {
    "storyId": "components-button--primary",
    "url": "http://localhost:6006/iframe.html?id=components-button--primary&viewMode=story",
    "navigated": true,
    "status": "rendered",
    "readiness": "storyRendered",
    "channel": true,
    "root": "#storybook-root",
    "warnings": []
  },
  {
    "storyId": "components-alert--danger",
    "url": "http://localhost:6006/iframe.html?id=components-alert--danger&viewMode=story",
    "navigated": false,
    "status": "errored",
    "readiness": "none",
    "channel": true,
    "root": "#storybook-root",
    "error": {
      "from": "story",
      "message": "components-alert--danger threw",
      "stack": "at Story"
    },
    "warnings": []
  }
]
```

`status` is one of `rendered`, `errored`, `missing`, `timeout`, `no-root`,
`unreachable`. `error.from` says which layer failed: `story` is the preview's
side of the bridge, `page` is the browser refusing to be driven, `observer` is
your own `observe` callback throwing on a story that rendered fine. `navigated`
is `true` exactly once in a healthy run; a second `true` means the channel was
not found and that story cost a reload, which also lands in `warnings`.

`collectStory` is the single-story form, with the same options and one outcome.

## What you need installed

- **Node 22 or newer.**
- **A built or served Storybook.** No Storybook package is a dependency or a
  peer dependency of this one, and nothing here imports from Storybook.
- Index shapes read: **v3** (the `stories` object), **v4 and v5** (the `entries`
  object). An index declaring a different `v`, or none, is read by whichever key
  is present, with a warning. Refusal is reserved for a file with neither key,
  or an entry missing a required field.
- The preview driver is written against **Storybook 7 and 8**: the story mounts
  into `#storybook-root`, the channel hangs on `window.__STORYBOOK_PREVIEW__`,
  and the fatal-error overlay is `sb-show-errordisplay`. `#root` (before 7) and
  `window.__STORYBOOK_ADDONS_CHANNEL__` with `removeListener` (Storybook 5) are
  also handled. Every one of these is an option you can override if a build
  renamed it.

Story discovery needs nothing authored: the subject list is the stories you
already have. The one thing a project may have to add to its own components is a
readiness marker, and only for stories that keep working after Storybook says
they rendered — see below.

## `toSubjects(index, options)`

| option | default | what it decides |
|---|---|---|
| `viewport` | none | the run's viewport, which per-story overrides are merged over. Optional, because a fully-specified override needs no base. A partial override with no base cannot be completed, and that story is excluded with the reason rather than rendered at a guessed size |
| `parameters` | none | per-story parameters by story id — `{ exclude?, viewport? }`. Supplied rather than read: the index records `type`, `title`, `name`, `importPath` and `tags`, and nothing else. Reading a story's own parameters means evaluating its module, which is the preview's job |
| `excludeTags` | none | stories tagged with any of these are excluded. Tags are the one piece of per-story policy the index does list, so this is the only opt-out that works without a running preview |

Viewport lengths may be numbers or `px` strings, because `px` strings are how
Storybook's own viewport entries are written. Any other unit is refused: `em` and
`vw` resolve against a font size and a window this package has not seen.

## `collectStories(page, storyIds, options)`

| option | default | what it decides |
|---|---|---|
| `baseUrl` | required | Storybook's root URL — `http://localhost:6006`, or a `file://` path to a built directory. An absolute URL: `localhost:6006` with no scheme is refused, naming the mistake |
| `readySelector` | none | CSS selector for a marker the story attaches once it has settled. When set, it is the only signal that can mark a story `rendered` |
| `timeoutMs` | `15000` | budget for one story to become ready |
| `pollMs` | `50` | markup sampling interval, on the fallback path only |
| `events` | `STORYBOOK_EVENTS` | the channel event names this adapter listens for — `{ setCurrentStory, updateGlobals, storyRendered, storyFinished, storyThrewException, storyErrored, storyMissing, playFunctionThrewException }`. Override any of them if a Storybook build renamed one |
| `globals` | `{ a11y: { manual: true } }` | Storybook globals to set on the preview, once per document, before any story is shown. The default stands `@storybook/addon-a11y`'s automatic scan down for this pass. Pass `{}` to change nothing |
| `roots` | `#storybook-root`, `#root` | where the story mounts, tried in order |
| `errorOverlay` | `STORYBOOK_ERROR_OVERLAY` | CSS selectors identifying Storybook's fatal-error overlay — `{ bodyClass: 'sb-show-errordisplay', message: '#error-message', stack: '#error-stack' }`. Only consulted when no channel was found, since there is then no event to name the error |
| `observe` | none | `collectStories` only: called after a story became ready and before the next is shown. This is where a capture goes. Called only for `rendered` stories, and sequentially — one call finishes before the next story is shown |

## Readiness

Without `readySelector`, a story is ready when Storybook's `storyRendered`
fires, and failing that when the mounted root's markup is unchanged across two
samples `pollMs` apart. Which of those decided it is in the outcome's
`readiness` field, so a report can tell a declared-ready capture from a guessed
one:

`declared` (your marker appeared) · `storyRendered` (Storybook's signal) ·
`already-rendered` (the story the URL selected was already on screen) ·
`markup-quiescent` (the fallback) · `none` (the status says what happened
instead).

Set `readySelector` for any component that fetches, animates, or defers work to
an effect. Those async gaps are what produce a capture that differs between
otherwise-identical runs. The marker is attached by your own component — there is
deliberately no default, since a marker nobody agreed to attach would never
appear and would turn every run into timeouts:

```jsx
<div data-testid="story-ready" />
```

When supplied, it becomes the only signal that can produce a `rendered` outcome.
`storyRendered` having already fired does not shorten the wait, and a story that
never attaches the selector times out naming it rather than being captured
early.

## The end of a render

`storyRendered` is not it. Storybook emits that event at `completed`, and a
render then goes on through `afterEach` to `finished`, where it emits
`storyFinished`. Ask Storybook to show a different story while a render is still
in one of the phases between the two and it treats that render as stuck: three
macrotask ticks of grace, then it reloads the whole preview.

A reload empties the page. Whatever your harness injected is gone, and the run
does not slow down — it stops observing. So `collectStory` hands a story back at
`storyRendered`, and waits for `storyFinished` before showing the next one. You
configure none of this; it is why a story with a slow `afterEach` costs that
story's own time and nothing after it.

Two things put work in that phase, and both are ordinary:

- `@storybook/addon-a11y` with `test` set runs an axe scan there, on every story.
- A story-level or global `afterEach` annotation.

Storybook has emitted `storyFinished` since 8.3. On anything older, the first
story of a session waits out `timeoutMs` to establish that the event is never
coming, and the rest of the run pays nothing.

Nor is there a wait for a story the preview is already showing. Storybook
re-renders only a story it is not already displaying, so asking for the same
subject twice in one page — which is how an order-dependent reading is told apart
from a regression — is answered by the render that already finished.

That event also says how the render ended. A story whose `play` threw after
the last paint, or whose `afterEach` raised, finishes with status `error`, and
the outcome includes a warning saying so. The status is not the outcome's status:
the picture is on screen and a capture of it is a capture of what the component
did, so the story is still `rendered`. The warning is for the baseline — a
subject that failed its own checks is not one to record as the way it should
look.

## What a pass tells the preview

Before the first story is shown, the session emits `updateGlobals` on the
preview's channel with `{ a11y: { manual: true } }`. That is the addon's own
switch — the one the manager's Accessibility panel flips — and it turns off the
axe scan `@storybook/addon-a11y` otherwise runs in `afterEach` on every story.
The pass would pay for that scan twice, once to run it and once to wait out the
phase it runs in, and read its answer never.

This does not replace axe. What it suppresses is a scan inside a document this
session opened and will close; channel globals die with that document, and
nothing in your project's configuration is touched. To keep your accessibility
run inside the visual pass, pass `globals: {}`.

The setting is applied over the channel after navigation, so the first story of a
session — already selected by the URL that loaded the preview — may still run one
scan. Set `globals` to whatever else your preview needs configured for the pass,
such as a theme: it replaces the default rather than merging with it.

## A pinned clock

A story built from `Date.now()` renders a different picture every run, so
pinning the clock is an ordinary fix. Which pin this survives, in Playwright's
vocabulary:

- `page.clock.setFixedTime` and `page.clock.setSystemTime` replace `Date` and
  leave timers and `performance` running. **Supported.** Nothing here measures
  anything with `Date`.
- `page.clock.install` also replaces `setTimeout` and `performance`, and advances
  only when you tick it. **Not supported while it is stopped**: a page whose
  timers never fire cannot render a story, and no deadline the driver sets can
  change that. Tick the clock, or install it after the capture.

## No Storybook-specific denylist

Nothing here prunes Storybook's chrome. The story mounts into
`#storybook-root`, so the preview reset, the addon layout and the error overlay
are outside the subject subtree and are dropped by ordinary CSS applicability
pruning. There is no separate list of things to exclude to maintain.

---

**[@variance-authority/storybook](https://variance-authority.dev/reference/packages/storybook)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
