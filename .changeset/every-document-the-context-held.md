---
'@variance-authority/playwright-test': minor
---

A spec is recorded whether or not it asks for `variance`

Under `varianceExecution`, recording used to read the page only when a spec
destructured `variance`: at each observation, and once more when that fixture
was torn down. A spec that took only `page`, which is how most Playwright specs
are written, was recorded as having executed nothing. The next `--since` then
skipped it over lines it had run.

Recording now reads the test's browser context. It reads after every `afterEach`
and before the context closes, from every frame of every page the test opened.
That covers a story running in Storybook's `#storybook-preview-iframe`, a second
tab opened with `context.newPage()`, and whatever an `afterEach` clicked.

A spec that replaced a document it ran in is recorded as incomplete: a second
`goto`, a `reload()`, a frame the application removed, or a page that closed or
crashed before the end. Whatever that document executed since the last read went
with it. The spec keeps the crossings that were read, and the next selection runs
it rather than skipping it. `pushState` and hash changes keep the same document
and lose nothing.
