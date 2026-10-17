---
'@variance-authority/cli': patch
'@variance-authority/core': patch
'@variance-authority/help': patch
'@variance-authority/history': patch
'@variance-authority/mcp': patch
'@variance-authority/playwright-test': patch
'@variance-authority/raster': patch
'@variance-authority/react': patch
'@variance-authority/report': patch
'@variance-authority/route-collector': patch
'@variance-authority/sense': patch
'@variance-authority/store': patch
'@variance-authority/storybook-collector': patch
'@variance-authority/tribunal': patch
'@variance-authority/vitest-browser': patch
---

A link in a doc comment opens from `node_modules`

Doc comments linked to documentation by repository paths such as
`../../../../docs/flakiness.md`, which resolve to nothing in an installed
package. They now link to the page on variance-authority.dev, or to the file on
GitHub when the site does not publish it, so the link works on hover in your
editor and in what `variance ask symbol` prints.

The MCP server's instructions and its observability answer linked to
`/start-cli` and `/presentation`, which the site does not serve. They now link
to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
`@variance-authority/help`, `@variance-authority/mcp` and
`@variance-authority/vitest-browser` READMEs link to the guides where the site
publishes them.

`variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
`@see` link to the section of the guide that documents them.
