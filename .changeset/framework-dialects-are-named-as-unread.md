---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

The READMEs and the `variance-authority` skill say that the source index does
not yet read framework file formats or bundler-only aliases: Vue and Svelte
single-file components are not indexed, the files an Angular component names in
`templateUrl` and `styleUrls` are not linked to it, and an import alias declared
only in a bundler's configuration does not resolve, where one declared as
`paths` in a `tsconfig` does.
