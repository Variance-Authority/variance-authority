---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/storybook-collector': minor
---

Recorded file names are relative to the repository root

The Jest, Vitest and Rstest wrappers, the Playwright reporter and the Storybook
collector now name every file relative to the root of the git checkout the run
starts in. Before, when the config was inside a package, file names were
relative to Jest's `rootDir` or Vitest's `root`. A recording made from
`packages/cart` said `src/cart.ts` where a diff says `packages/cart/src/cart.ts`,
and the two never matched. `rootDir` and `root` still resolve the config and the
relative paths in its options. Outside a git checkout, names are relative to the
directory the run starts in.

A recording that an earlier version made from a package-level config uses the
old names, so record it again. `repositoryRoot`, exported from
`@variance-authority/sense/test-selection`, returns the directory that file
names are relative to.
