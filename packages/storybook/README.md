<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook

> Storybook index parsing, subject planning and a host-neutral preview driver.

Use this package when you need Storybook index parsing, subject planning, or a
host-neutral preview driver. A *subject* is the one thing under test — here, one
Storybook story. *Subject planning* is turning the index's raw story list into
an ordered, filtered plan of which subjects a run will actually observe. For the
complete CLI/browser workflow, use `@variance-authority/storybook-collector`.
This package does not mount stories or choose a browser for you.

**Requires:** a built Storybook's `index.json` as a value. `storybook/read`
additionally requires a readable path, and driving a preview requires a page
object you supply with `url`, `goto`, and `evaluate` methods.

Install it when a custom integration owns the preview page or only needs the
index/subject helpers:

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
   read — by whichever of `entries`/`stories` is actually present — with a
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
adapter in `@variance-authority/storybook-collector`
owns the browser and capture callback for a normal visual run.

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
| `events` | `STORYBOOK_EVENTS` | the channel event names this adapter listens for — `{ setCurrentStory, storyRendered, storyThrewException, storyErrored, storyMissing, playFunctionThrewException }`. Override any of them if a Storybook build renamed one |
| `roots` | `#storybook-root`, `#root` | where the story mounts, tried in order |
| `errorOverlay` | `STORYBOOK_ERROR_OVERLAY` | the CSS selectors that identify Storybook's fatal-error overlay — `{ bodyClass: 'sb-show-errordisplay', message: '#error-message', stack: '#error-stack' }`. Only consulted when no channel was found, since there is then no event to carry the error |
| `observe` | none | `collectStories` only: called after a story became ready and before the next is shown. This is where a capture goes. Called only for `rendered` stories, and sequentially — one call finishes before the next story is shown |

## Readiness

`readySelector` is worth configuring for any component that fetches, animates,
or defers work to an effect. Those async gaps are what cause a *flake*: a
capture that differs between otherwise-identical runs because it was taken
before the component had actually finished rendering.

Supplied, it becomes the only signal that can produce a `rendered` outcome: a
story that never attaches the selector **times out rather than being captured
early**.

Without it, readiness falls back to Storybook's own `storyRendered` event, and
below that to markup quiescence — the mounted root's markup being unchanged
across two polls, `pollMs` apart. Either fallback is recorded as such in the
outcome's `readiness` field, so a report can tell a declared-ready capture from
a guessed one.

## No Storybook-specific denylist

Nothing here prunes Storybook's chrome, and it does not have to. The story mounts
into `#storybook-root`, so the preview reset, the addon layout and the error
overlay are outside the subject subtree and are dropped by ordinary CSS
applicability pruning. No separate list of things to exclude is maintained.

