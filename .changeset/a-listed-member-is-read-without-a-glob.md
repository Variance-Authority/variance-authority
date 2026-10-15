---
'@variance-authority/package': patch
---

A `workspaces` entry that is a plain path is read without a glob

A large monorepo can list its members one path at a time: one product's root
manifest lists two thousand directories and no wildcard. Every entry used to
start a glob of its own, so each read of the manifests spent seconds listing
directories when one check of the path would do. A plain entry is now read as
the `package.json` inside the directory it names, and a wildcard entry is still
read as a glob. An entry under `node_modules` is still never read, as a glob
never reads one.
