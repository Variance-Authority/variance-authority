---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A changed `package.json` is set aside only when the install comparison reads all of its change. A diff that moves `exports`, `imports`, `main`, `module`, `browser`, `type`, `sideEffects`, `name` or any field outside the dependency and publishing fields selected nothing and printed that the diff changed only manifests, while every importer of that package now loaded a different file. Each changed manifest is now read at both revisions, and one that moved a field the lockfile does not hold makes its package a changed directory: the walk reaches every importer, and a journal read charges every file of the package whole. `manifestMoved` in `@variance-authority/sense/lock` owns which fields the install speaks for.
