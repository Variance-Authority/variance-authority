---
'@variance-authority/sense': minor
---

The Vitest integration declares the config file it ran under

The config file Vite loaded, and the local modules it bundled into it, are
preconditions of every test the seam records, beside the setup files. An edit to
`vitest.config.ts`, or to a module it imports, now selects the whole suite; a
package the config imports is read as the install. A configuration that lists
projects declares its own file too. Jest and Rstest do not say which config file
they loaded, so name it in `preconditions` there.
