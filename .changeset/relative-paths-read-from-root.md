---
'@variance-authority/playwright-test': patch
'@variance-authority/storybook-collector': patch
---

A relative `coverageFile` or `executionFile` is read from `root`

The Vitest, Rstest and Jest integrations resolve these two paths from their own
root. The Playwright reporter and the Storybook recorder resolved them from the
root of the repository instead. In a workspace, where `root` is a package
directory, that caused two problems:

- The Playwright workers staged their results beside one coverage index, and the
  reporter merged them into a different one.
- A run where the fixture merged for itself, without the reporter, wrote its
  execution index to a third place.

Both paths are now read from `root`, as the fixture already read `coverageFile`.
An absolute path is unchanged.
