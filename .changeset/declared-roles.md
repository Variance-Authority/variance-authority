---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

An export's doc comment can declare its role with `@testOnly` or `@production`, and `variance restrictions` checks it with no `.relations.json`. It lists every shipped file that imports a `@testOnly` export, directly or through re-exports; every `@production` export that only tests import; and every export that declares both. What a `*.stories.*`, `*.story.*` or `*.examples.*` file imports from its own directory or below is held to its role as shipped code is, while what it imports from elsewhere stays test code; the code map counts `*.examples.*` files as tests. `Export.roles` gives the declared roles, and `declaredRoles()` runs the check. The source index format is version 16, so `variance index` rebuilds it once.
