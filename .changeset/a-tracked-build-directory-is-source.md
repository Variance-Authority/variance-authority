---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

An import into a `build/` directory Git tracks lands on the file it names. The scan already read a tracked `build/` as source, but it declined any resolved target under a directory named `build`, so an import such as `./build/build` in Docusaurus's `src/commands/cli.ts` kept its specifier under `unresolved`, and an edit to that command reached nothing that imports it. A tracked `build/` file is now a target like any other, whichever way the scan reads the tree. An import of one that your change adds or removes lands on the same file, so selection walks from it when it asks the `sideEffects` field what loading it does. A `build/` your `.gitignore` covers stays declined, a scan with `digests: false` declines every `build/` because it does not ask Git, and `dist/` and the other output directories stay declined whatever Git tracks. Stored records are read again once, because records change where they point.
