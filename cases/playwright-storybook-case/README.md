# A Playwright suite over a Storybook it opens itself

Your Playwright specs probably look like the ones in this case. They call
`page.goto` on a Storybook URL, click, and assert. They import nothing from this
project except the `test` your fixture module exports, and they never ask for a
fixture by name. This case shows that such a suite is still recorded: every
spec, by the source regions its own pages executed, so the next run can skip the
specs a change could not have touched.

## What this demonstrates

Storybook is built by its own CLI, with `testSelectionProbes()` added in
`viteFinal`, and served as static files, the way a deployed Storybook is served.
Seven ordinary specs then run against it through the real Playwright CLI, on
two workers:

| Spec | What it does | Why it is here |
| --- | --- | --- |
| [`plain.spec.mjs`](src/spec/plain.spec.mjs) | Opens one story and asserts it. | The shape most suites are made of. |
| [`manager.spec.mjs`](src/spec/manager.spec.mjs) | Opens Storybook's manager and clicks inside `#storybook-preview-iframe`. | The application is not the top document. |
| [`popup.spec.mjs`](src/spec/popup.spec.mjs) | Opens a second tab with `context.newPage()`. | The branch it checks runs only in that second tab. |
| [`after-each.spec.mjs`](src/spec/after-each.spec.mjs) | Leaves the click for `test.afterEach`. | The hook's execution belongs to the test it ran after. |
| [`variance.spec.mjs`](src/spec/variance.spec.mjs) | Asks for the `variance` fixture. | Recording does not depend on whether a spec asks for a fixture. |
| [`navigate.spec.mjs`](src/spec/navigate.spec.mjs) | Calls `goto` twice in one tab. | The second document replaces the first. |
| [`reload.spec.mjs`](src/spec/reload.spec.mjs) | Calls `page.reload()`. | Same as above: the reload replaces the document. |

A page's crossings are read once the test is done with its browser context:
after every `afterEach`, while the pages are still open, from every frame of
every page. A document that was replaced during the test, by a second `goto`, a
reload, a removed frame or a closed tab, cannot be read afterwards. The spec is
still recorded with what its last document executed, but it is marked
incomplete. An incomplete record is never trusted to show that the spec did not
reach a change, so the next selection runs that spec instead of skipping it. Two
things do not replace a document: `pushState` and a hash change. A single-page
application moving between its own routes loses nothing.

## The files

| Path | What it is |
| --- | --- |
| [`src/price.js`](src/price.js) | Product source: `price` doubles anything over 10, and `discount` takes 10 off anything over 100. It knows nothing about a test. |
| [`src/Price.jsx`](src/Price.jsx), [`src/price.stories.jsx`](src/price.stories.jsx) | Two components and three stories: a plain price, a premium price, and a checkout that discounts once you pay. |
| [`.storybook/main.js`](.storybook/main.js) | Adds `testSelectionProbes({ label: 'storybook' })` to the Vite build. This is the only change to the Storybook setup. |
| [`src/spec/fixtures.mjs`](src/spec/fixtures.mjs) | `base.extend(varianceFixtures)`: the only line the specs import. |
| [`src/playwright.config.mjs`](src/playwright.config.mjs) | `withTestSelection()` around an otherwise ordinary config, with the same label as the build. It serves the build through `webServer`. |
| [`src/server.mjs`](src/server.mjs) | A static file server for the build. |
| [`src/workflow.chromium.test.js`](src/workflow.chromium.test.js) | The outer Vitest file. It builds Storybook and runs the specs in a throwaway directory, then asks the coverage file which specs a change to `price.js` needs. |

## Run it

You need a checkout, `yarn install`, a built workspace (`yarn build`), and a
Chromium binary (`npx playwright install chromium`). Without the browser, the
case prints the install command and skips; it does not fail.

From the repository root:

```bash
yarn vitest run cases/playwright-storybook-case/src/workflow.chromium.test.js
```

## The questions the outer file asks

The outer file reads each line number from the source, builds a one-hunk diff at
that line, and asks `narrowByExecution` about it:

- **`return amount * 2`**: `plain`, `popup`, `reload` and `variance` entered it.
  `popup` reached it only through the tab it opened itself.
- **`return amount - 10`**: `after-each`, `manager` and `navigate` entered it.
  All three reached it after a click: in the hook, inside the manager's iframe,
  and after the navigation.
- **`return amount;`** in `price`: only `popup` entered it. `navigate` rendered a
  plain price too, but in the document its second `goto` replaced. So it is not
  listed as having entered the line, and it is not listed as whole either. A
  selection built on this answer runs it anyway.

## Scope

The build writes its head inventory to your cache, keyed by repository. The
outer file points `XDG_CACHE_HOME` at its own temporary directory, which keeps
the run out of your cache. The coverage file and Playwright's results go to the
same temporary directory, and it is removed when the run ends.

A document the spec replaced is not read after it goes, so that spec runs again
rather than being skipped. A context a spec creates for itself through
`browser.newContext()` is not read at all: a page is recorded when the test
opens it from the context Playwright handed it.
