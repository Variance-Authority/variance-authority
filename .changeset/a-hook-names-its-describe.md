---
'@variance-authority/playwright-test': minor
---

A `variancePrecondition` said in a Playwright `beforeEach` sits at the level of
the `describe` that declared the hook, as it does under Vitest, Jest and Rstest:
`0` at the top of the file, one deeper for each `describe` around it. A
`beforeEach` inside a `describe` overrides one at the top of the file for the
same name, where both were read at the case's innermost `describe` and kept as a
contradiction. A helper that declares a `beforeEach` from one line in a
`describe` and again in one inside it is placed at the depth of the one running.

Playwright does not publish which `describe` declared a hook, so a recording
worker reads it from Playwright's internals: run on 1.62.1, and read in the
source of 1.58, 1.59 and 1.63, whose test loader sits at either of two paths. A
Playwright that lacks one of them fails every recorded test at setup, naming
the internal and its version, rather than placing a `beforeEach` precondition at
a guessed level.
