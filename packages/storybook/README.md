<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook

> Storybook index parsing, subject planning and a host-neutral preview driver.

Use this package when you need Storybook index parsing, subject planning, or a
host-neutral preview driver. A *subject* is the one thing under test — here, one
Storybook story. *Subject planning* is turning the index's raw story list into
an ordered, filtered plan of which subjects a run will actually observe. For the
complete CLI and browser workflow, use `@variance-authority/storybook-collector`.
This package does not mount stories or choose a browser for you.

It takes a built Storybook's `index.json` as a value. `storybook/read` takes a
readable path instead, and driving a preview needs a page object you supply,
with `url`, `goto`, and `evaluate` methods.

Install it when a custom integration owns the preview page or only needs the
index and subject helpers:

```bash
npm install --save-dev @variance-authority/storybook
```

A project's own Storybook is the subject list. There is no separate test format
to author: a subject is whatever the existing stories already mount.

## Requirements and host boundary

The package has two explicit host boundaries:

- **Browser-free index and planning helpers.** `harnessPage` adapts a
  `BrowserHarness` — an object shaped `{ page }`, where `page` exposes
  `url(): string`, `goto(url, options?)`, and `evaluate(fn, arg)` — into the
  smaller interface this package actually drives. Nothing here imports a `Page`
  type from a browser library, so reading a story index never pulls a browser
  into the dependency tree. Storybook support and Playwright support are
  separate concerns that meet at a URL and a function call.
- **Caller-owned input.** `index.json` arrives as a value. The one function that
  reads it off a disk is `@variance-authority/storybook/read`, because a project
  fetching it from a running dev server, or holding it in memory, or pulling it
  out of a build artifact store wants the parser and no disk at all.

## Public steps

```ts
import { readStoryIndex } from '@variance-authority/storybook/read';
import { toSubjects } from '@variance-authority/storybook';

const index = await readStoryIndex('storybook-static/index.json');
const plan = toSubjects(index, { excludeTags: ['docs'] });

console.log(plan.subjects.map(({ story }) => story.id));
```

1. **`parseStoryIndex`** reads what a built Storybook declares, and refuses
   anything that is not that. No browser, no evaluation, no `.storybook/`. It
   recognizes index versions 3 (the older `stories` shape) and 4 and 5 (the
   newer `entries` shape). An index that declares a different or no `v` is still
   read — by whichever of `entries` or `stories` is actually present — with a
   warning attached to the returned `warnings` array rather than a refusal.
   Refusal is reserved for a file with neither key, or an entry missing a
   required field. Call it directly on an index you already hold;
   `readStoryIndex` is the same parser with a `readFile` in front of it, for the
   disk case above.
2. **`toSubjects`** applies policy — exclusion by tag, viewport, a deterministic
   order. Excluded stories stay in the plan as `excluded` rather than being
   dropped, so a run still accounts for them. Pure.
3. **`collectStories`** drives a preview page that is already open, moving
   between stories over Storybook's own channel — the `postMessage` bridge
   Storybook's manager UI normally uses to tell the preview iframe which story
   to show — rather than reloading the page for each one. One navigation for a
   whole run; if no channel is found, a story instead costs a reload, and that
   is reported in the outcome's warnings rather than absorbed silently.

The snippet above is the smallest complete path: it reads the built artifact and
returns an ordered, policy-filtered plan. It does not open a browser. The CLI
adapter in `@variance-authority/storybook-collector` owns the browser and the
capture callback for a normal visual run.

## Drive an existing preview

Use this adapter only when another integration already owns the page. The page
must satisfy the exported `BrowserHarness` shape; this package does not create
one. The following is an illustrative adapter contract, not a browser launcher:

```ts
import {
  collectStories,
  harnessPage,
  type BrowserHarness,
} from '@variance-authority/storybook';

declare const ownedPage: BrowserHarness['page'];
const harness: BrowserHarness = { page: ownedPage };

const outcomes = await collectStories(
  harnessPage(harness),
  ['checkout--empty'],
  { baseUrl: 'http://localhost:6006' },
);
```

`collectStories` reports navigation, readiness, and story failures; it does not
capture pixels. Supply `observe` when the host owns capture, and use the
collector package when the CLI should own that composition.

## Options

`toSubjects(index, options)`:

| option | default | what it decides |
|---|---|---|
| `viewport` | none | the run's viewport, which per-story overrides are merged over. Optional, because a fully-specified override needs no base. A *partial* override with no base cannot be completed, and that story is excluded with the reason rather than rendered at some default — a story that asked for 320px and got 1280px is a wrong observation, which is worse than a missing one |
| `parameters` | none | per-story parameters by id, supplied rather than read: the index does not carry them |
| `excludeTags` | none | stories carrying any of these tags are excluded. Tags are the one piece of per-story policy the index really does carry, so this is the only opt-out that works without a running preview |

`collectStories(page, storyIds, options)` and the single-story `collectStory`:

| option | default | what it decides |
|---|---|---|
| `baseUrl` | required | Storybook's root URL — `http://localhost:6006`, or a `file://` build |
| `readySelector` | none | CSS selector for a marker the story attaches once it has settled (see Readiness, below). When set, it is the only signal that can mark a story `rendered` |
| `timeoutMs` | `15000` | budget for one story to become ready |
| `pollMs` | `50` | markup sampling interval, on the fallback path only |
| `events` | `STORYBOOK_EVENTS` | the channel event names this adapter listens for — `{ setCurrentStory, updateGlobals, storyRendered, storyFinished, storyThrewException, storyErrored, storyMissing, playFunctionThrewException }`. Override any of them if a Storybook build renamed one |
| `globals` | `{ a11y: { manual: true } }` | Storybook globals to set on the preview, once per document, before any story is shown. The default stands `@storybook/addon-a11y`'s automatic scan down for this pass. Pass `{}` to change nothing |
| `roots` | `#storybook-root`, `#root` | where the story mounts, tried in order |
| `errorOverlay` | `STORYBOOK_ERROR_OVERLAY` | the CSS selectors that identify Storybook's fatal-error overlay — `{ bodyClass: 'sb-show-errordisplay', message: '#error-message', stack: '#error-stack' }`. Only consulted when no channel was found, since there is then no event to carry the error |
| `observe` | none | `collectStories` only: called after a story became ready and before the next is shown. This is where a capture goes. Called only for `rendered` stories, and sequentially — one call finishes before the next story is shown |

## Readiness

`readySelector` is worth configuring for any component that fetches, animates,
or defers work to an effect. Those async gaps are what cause a *flake*: a
capture that differs between otherwise-identical runs because it was taken
before the component had actually finished rendering.

When supplied, it becomes the only signal that can produce a `rendered` outcome: a
story that never attaches the selector **times out rather than being captured
early**.

Without it, readiness falls back to Storybook's own `storyRendered` event, and
below that to markup quiescence — the mounted root's markup being unchanged
across two polls, `pollMs` apart. Either fallback is recorded as such in the
outcome's `readiness` field, so a report can tell a declared-ready capture from
a guessed one.

## The end of a render

`storyRendered` is not it. Storybook emits that event at `completed`, and a
render then goes on through `afterEach` to `finished`, where it emits
`storyFinished`. Ask Storybook to show a different story while a render is still
in one of the phases between the two and it treats that render as stuck: three
macrotask ticks of grace, then it reloads the whole preview.

A reload empties the page. Whatever your harness injected is gone, and the run
does not slow down — it stops observing. So `collectStory` hands a story back at
`storyRendered`, and waits for `storyFinished` before showing the next one. You
do not configure any of this; it is why a story with a slow `afterEach` costs
that story's own time and nothing after it.

Two things put work in that phase, and both are ordinary:

- `@storybook/addon-a11y` with `test` set runs an axe scan there, on every story.
- A story-level or global `afterEach` annotation.

Storybook has emitted `storyFinished` since 8.3. On anything older, the first
story of a session waits out `timeoutMs` to establish that the event is never
coming, and the rest of the run pays nothing.

Nor is there a wait for a story the preview is already showing. Storybook
re-renders only a story it is not already displaying, so asking for the same
subject twice in one page — which is how an order-dependent reading is told
apart from a regression — is answered by the render that already finished, and
that finish is remembered rather than waited for again.

That event also carries how the render ended. A story whose `play` threw after
the last paint, or whose `afterEach` raised, finishes with status `error`, and
the outcome carries a warning saying so. The status is not the outcome's status:
the picture is on screen and a capture of it is a capture of what the component
did, so the story is still `rendered`. What the warning is for is the baseline —
a subject that failed its own checks is not one to record as the way it should
look.

## What a pass tells the preview

Before the first story is shown, the session emits `updateGlobals` on the
preview's channel with `{ a11y: { manual: true } }`. That is the addon's own
switch — the one the manager's Accessibility panel flips — and it turns off the
axe scan `@storybook/addon-a11y` otherwise runs in `afterEach` on every story.
The pass pays for that scan twice, once to run it and once to wait out the phase
it runs in, and reads its answer never.

This does not replace axe, and nothing here claims to. What it suppresses is a
scan inside a document this session opened and will close; channel globals die
with that document, and nothing in your project's configuration is touched. If
you want your accessibility run to stay in the visual pass, pass `globals: {}`.

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
  timers never fire cannot render a story, and no deadline the driver holds can
  change that. Tick the clock, or install it after the capture.

## No Storybook-specific denylist

Nothing here prunes Storybook's chrome, and it does not have to. The story mounts
into `#storybook-root`, so the preview reset, the addon layout and the error
overlay are outside the subject subtree and are dropped by ordinary CSS
applicability pruning. No separate list of things to exclude is maintained.

