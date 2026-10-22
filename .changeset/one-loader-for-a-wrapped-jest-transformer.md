---
'@variance-authority/jest-transformer': minor
'@variance-authority/sense': patch
'@variance-authority/isolator': minor
---

New package `@variance-authority/jest-transformer` loads a project's own Jest transformer the way Jest does — resolved from the project or where `jest-config` finds it, required or imported, built by its `createTransformer` — and answers which files Jest calls tests, for a transformer that runs around it. The Jest transformers of `@variance-authority/sense` and `@variance-authority/isolator` both reach the project's transformer through it. Sense's now calls the wrapped transformer's methods bound to it, so a class-based transformer that reads `this` keeps it. Both hand the wrapped transformer the options its own entry gave, and `{}` when it gave none, never their own. Isolator tests a `testRegex` against the path as the runner spells it, as Jest does, rather than with its separators turned to `/`.
