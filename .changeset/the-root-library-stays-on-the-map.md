---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`ask orient` keeps a root package on the map beside a package nested in it, and its file count covers the root's sources. A root joins when its manifest has a `name`, it holds source, and it declares no workspaces, in `workspaces` or in the `packages:` of a `pnpm-workspace.yaml`. A root that declares workspaces stays out, and that repository's map does not change.
