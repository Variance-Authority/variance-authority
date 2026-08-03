# @variance-authority/storybook

**Requires:** a built Storybook's `index.json`, **as a value** — you decide where
it came from. `storybook/read` requires a readable path; driving a preview
requires a page object you supply, which is three methods you can write by hand.

A project's own Storybook as the subject list. There is no separate test format
to author and no DSL to learn — a subject is whatever your existing stories
already mount.

## Why it needs neither a browser nor a disk

Both would have been easy to require, and both would have been wrong:

- **Not a browser.** `harnessPage` names the three page methods it drives
  (`url`, `goto`, `evaluate`) instead of importing a `Page`. Six lines of
  interface against a browser in the dependency tree of everyone who reads a
  story index. Storybook support and Playwright support are separate concerns
  that meet at a URL and a function call.
- **Not a filesystem.** `index.json` arrives as a value. The one function that
  reads it off a disk is `@variance-authority/storybook/read`, because a project
  fetching it from a running dev server, or holding it in memory, or pulling it
  out of a build artifact store wants the parser and no disk at all.

## Three steps, kept apart because they fail differently

```ts
import { toSubjects, collectStories, harnessPage } from '@variance-authority/storybook';
import { readStoryIndex } from '@variance-authority/storybook/read';

const index = await readStoryIndex('storybook-static/index.json');  // parseStoryIndex, off a disk
const plan = toSubjects(index, { excludeTags: ['docs'] });

const outcomes = await collectStories(harnessPage(harness), plan.subjects.map((s) => s.story.id), {
  baseUrl: 'http://localhost:6006',
  readySelector: '[data-testid="story-ready"]',
  observe: async (outcome) => { /* capture, compare, whatever you already do */ },
});
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

## Readiness, and why a declared marker never falls back

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
applicability pruning ([ADR-0003](../../docs/context/adr/0003-cruft-removal-and-css-applicability.md)).
A denylist would be a second normalization ruleset, versioned by nobody.

## Reading

- [ADR-0020](../../docs/context/adr/0020-read-the-artifact-not-the-configuration.md) — why this reads `index.json` and not `.storybook/`
- [`cases/storybook-case`](../../cases/storybook-case) — a real Storybook, built by Storybook, read from outside
