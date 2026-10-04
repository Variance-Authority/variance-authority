---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
'@variance-authority/playwright-test': patch
---

The skill reads the state each covering test ran under

The `variance-authority` skill has a `case-preconditions` reference: which tests
ran a function with discounted prices mocked, the state each test covering a
function ran under, a test's flag-off twin, how a test helper records the state
it sets, and what to do when `--where` answers unmeasured. The skill's config
table and its `covering` reference say that `covering` reads `names` from the
root `variance.config.json`. The `@variance-authority/sense` and
`@variance-authority/cli` READMEs say a case precondition records the state a
test ran under, and link to the public case preconditions page; the
`@variance-authority/playwright-test` README links to the renamed section.
