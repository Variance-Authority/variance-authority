---
'@variance-authority/sense': patch
---

`variance ask stack` reads a file in a nested project against that project's manifest

A project nested in your checkout, with its own `package.json` and its own
install, is not always one of the root's `workspaces`: a docs site or an editor
extension usually is not. Its files were read against the root manifest, so
every package the project declares showed as imported and not declared, and its
imports were charged to the root. Now each file is read against the nearest
`package.json` above it that has a `name`, as Node resolves its imports, in
`ask stack` and in the third-party names `ask search` and `ask symbol` offer.
The next `variance index` rebuilds the dependency lexicon once, to pick the
nested manifests up.
