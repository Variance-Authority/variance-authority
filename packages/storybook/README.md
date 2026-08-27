<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook

> Storybook index parsing, subject planning and a host-neutral preview driver.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Use this package when you need Storybook index parsing, subject planning, or a
host-neutral preview driver. For the complete CLI/browser workflow, use
`@variance-authority/storybook-collector`. This package
does not mount stories or choose a browser for you.

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

- **Browser-free index and planning helpers.** `harnessPage` names the three
  page methods it drives (`url`, `goto`, `evaluate`) instead of importing a
  `Page`. Six lines of interface against a browser in the dependency tree of
  everyone who reads a story index. Storybook support and Playwright support
  are separate concerns that meet at a URL and a function call.
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
   anything that is not that. No browser, no evaluation, no `.storybook/`.
   Dispatches on the key that is present rather than on `v`, so a newer index in
   a familiar shape is read and *warned about* rather than refused. Call it
   directly on an index you already hold; `readStoryIndex` is the same parser
   with a `readFile` in front of it, for the disk case above.
2. **`toSubjects`** applies policy — exclusion by tag, viewport, a deterministic
   order. Excluded stories stay in the plan as `excluded` rather than being
   dropped, so a run still accounts for them. Pure.
3. **`collectStories`** drives a preview page that is already open, moving between
   stories over Storybook's own channel rather than reloading. One navigation for
   a whole run; a second one is *reported*, not counted internally.

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
| `readySelector` | none | see below. The one signal that can end a flake instead of re-running it |
| `timeoutMs` | `15000` | budget for one story to become ready |
| `pollMs` | `50` | markup sampling interval, on the fallback path only |
| `events` | `STORYBOOK_EVENTS` | the channel event names. Configuration rather than a constant because they belong to a package this one does not depend on |
| `roots` | `#storybook-root`, `#root` | where the story mounts, tried in order |
| `errorOverlay` | `STORYBOOK_ERROR_OVERLAY` | how the preview renders a fatal error, consulted only on the channel-less path where there is no event to carry it. Presentation details of somebody else's package, so they are configuration |
| `observe` | none | `collectStories` only: called after a story became ready and before the next is shown. This is where a capture goes. Sequential by contract, and called only for `rendered` stories — capturing the *previous* story's markup under this story's id is how a suite acquires a baseline that never corresponded to anything |

## Readiness

`readySelector` is worth the configuration for any component that fetches,
animates, or defers work to an effect — the stories that make a suite flaky.

Supplied, it becomes the only thing that can produce a `rendered` outcome, and a
story that never attaches it **times out rather than being captured on weaker
evidence**. There is no fallback because there is nothing to fall back *to*: the
difference between a declared contract and a guess is that the guess photographs
a loading spinner and calls it the component.

Without it, readiness is Storybook's own `storyRendered` signal, with markup
quiescence as an explicitly weaker fallback that says so in the outcome.

## No Storybook-specific denylist

Nothing here prunes Storybook's chrome, and it does not have to. The story mounts
into `#storybook-root`, so the preview reset, the addon layout and the error
overlay are outside the subject subtree and are dropped by ordinary CSS
applicability pruning.
A denylist would be a second normalization ruleset, versioned by nobody.

