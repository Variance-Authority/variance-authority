---
'@variance-authority/cli': patch
---

A suite is set up by how it reaches the code

The agent skill now covers setting up a suite's `before` and `relations` in
`variance.config.json`, not only fixing a selection that came back wrong. It
starts from how the suite reaches the code: a suite that imports what it tests
keeps `relations`, and one that drives an app or a built Storybook from another
process sets `"relations": false`. It lists which files the Vitest, Jest and
Rstest integrations already record, and which you name yourself: `globalSetup`
in every runner, Jest's `globalTeardown`, Jest's and Rstest's config file, Jest's `moduleNameMapper` and `transform`
targets, and everything a Playwright config names. For a suite over Storybook,
it names `.storybook/`.
