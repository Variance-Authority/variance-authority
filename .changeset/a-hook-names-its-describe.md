---
'@variance-authority/playwright-test': patch
---

A `variancePrecondition` said in a Playwright `beforeEach` sits at the level of
the `describe` that declared the hook, as it does under Vitest, Jest and Rstest:
`0` at the top of the file, one deeper for each `describe` around it. A
`beforeEach` inside a `describe` overrides one at the top of the file for the
same name, where both were read at the case's innermost `describe` and kept as a
contradiction. A helper that declares a `beforeEach` from one line in a
`describe` and again in one inside it is placed at the depth of the one running.
