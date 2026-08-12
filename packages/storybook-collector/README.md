# @variance-authority/storybook-collector

**Requires:** a browser binary on the machine, and a Storybook that has been
built or is being served. The build is the input — a `.storybook` configuration
is never read.

```bash
npx playwright install chromium
```

The collector `variance run` needs, shipped instead of written.

## Why this ships rather than being written per project

Mounting is the adopter's, once, per project. That holds for applications, where
only the project knows how its own app comes up. Storybook is the exception, and
a hand-written collector is what prices it: `cases/storybook-case/collector/` is
**341 lines across three files**, against a source comment guessing "about
thirty".

Of those 341 lines, the parts that are genuinely *that project's* are a map of
three ready selectors and a directory to scan for components. Everything else is
Storybook's own contract being re-typed: serving the build, injecting the page
bundle, driving the preview channel, acquiring a document and a capture from one
mount, normalizing, and shutting down without hanging on a socket.

A story index is a documented artifact and a preview owns its own mount. For this
one subject source the mounting problem is already solved by somebody else, so
charging every adopter to re-solve it charges them for our boundary rather than
for their project.

**The same case reads:**

```js
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'case-surface--deferred': '[data-testid="case-ready"]' },
  source: { dirs: ['cases/storybook-case/src'] },
});
```

Five lines of code, and `cases/storybook-case/src/cli.chromium.test.js` — *9 new
(exit 1) → 9 accepted (0) → 9 unchanged (0) → 5 changed (exit 1)* over a real
Storybook — passes against it. That test is the evidence this package is entitled
to, and it is written against the seam rather than against either collector, so
which side of it does the work is invisible to the test.

## What is the adopter's, and why

**Readiness, per story.** Storybook's `storyRendered` fires when the story
function returns, which for a component that defers work is *before the component
exists*. A story that declares a marker and never attaches it times out saying
which selector it waited for — there is no fallback, because falling back is how
you photograph a spinner and call it a component. A project-wide default would be
a guess about every component to solve a problem one of them has.

**Where the components live.** A directory and a set of extensions, scanned with
a regex. Omitted, the report names components and no files. An empty scan is
refused rather than returned: an index with nothing in it produces a report where
every component resolves to no file, which reads exactly like a project whose
components are anonymous and is instead a mistyped path.

## Options

| | |
|---|---|
| `ready` | story id → the selector that says it is ready |
| `source` | `{ dirs, extensions?, exclude? }` — component to `file:line` |
| `baseUrl` | a Storybook already served, e.g. `http://localhost:6006`. Preferred when it exists, because then nothing here has an opinion about how the build is hosted. Omitted, the directory holding `subjects.index` is served on a loopback port for the life of the run |
| `headless` | defaults to `true` |
| `roots` | story mount points, tightest first. Defaults to `#storybook-root`, `#root` |

## One navigation, and nothing rinsed between stories

The harness is pointed at the preview, so `collectStory` finds itself already
there and does not navigate again: N stories cost one navigation, and stories are
switched over Storybook's own channel. That is the saving
[ADR-0009](../../docs/context/adr/0009-sessions-detect-instead-of-rinse.md) rests
on, and warm captures are 7.5 ms against 205 ms cold.

Nothing prunes Storybook's chrome and nothing needs to. The story mounts into
`#storybook-root`, so the preview reset, the addon layout and the error overlay
sit outside the subject subtree and are dropped by ordinary CSS applicability
pruning. A Storybook-specific denylist would be a second normalization ruleset
versioned by nobody.

## What it does not make generic

Anything that is not Storybook. A Playwright suite, a route table or a bespoke
mount is still a collector somebody writes — or, for a Playwright suite,
[`@variance-authority/playwright-test`](../playwright-test), where the adopter's
own test body plays that part instead.

And it does not rank causes above collateral. A durable baseline is an image with
no document behind it, so no previous snapshot exists to name the roots of a
change and the docket falls back to area — which measures displacement, and which
this project measured as backwards by 6×.
