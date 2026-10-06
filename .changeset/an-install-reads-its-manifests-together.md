---
'@variance-authority/cli': patch
---

Comparing the install at a commit reads every changed `package.json` and the lockfile at that commit in one git process, instead of one `git show` per file. A diff that touched 46 workspace manifests made `variance select` 0.35 s faster on this repository. A patch handed to `variance select` is read the same way: every blob its `index` lines name, in one `git cat-file --batch`, where it started two `git cat-file` processes per manifest at once. Which manifests count as moved is unchanged.
