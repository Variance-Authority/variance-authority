---
"@variance-authority/cli": minor
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

A call the source leaves short is placed from what the case ran, and no test runner's config is read

The journeys walk no longer reads Vite's or Vitest's `resolve.alias`. When an import resolves to no function, the walk places the call on the one function the case entered that a file of the checkout exports under the imported name. That is the default export for a default import, and the member for a call through a namespace import. When the import names a workspace package, the function must be exported from that package. An import of a Node builtin, or of a package a manifest declares and no workspace holds, is never placed this way. When several entered functions match, the call is reported as ambiguous, and the walk's other inferences still get a turn. An import that resolves to a function the case did not enter stays where it resolved. `variance index` counts both outcomes in its journeys line, and the orient legend names a recorded caller.

`@variance-authority/sense` no longer exports `runnerAliases`, `runnerConfigs`, `runnerDigest`, `keptRunnerAliases`, `unlistedRunnerAliases`, or the types `RunnerAlias` and `RunnerAliases`. `NativeJourneysPrepared` loses the `aliased` and `runnerUnread` fields, and `prepareJourneys` on the native binding takes the Node builtin names as a new last argument.
