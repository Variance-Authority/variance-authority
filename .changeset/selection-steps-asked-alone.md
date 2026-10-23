---
'@variance-authority/sense': minor
---

Each step of test selection can be asked alone, over an open record and with its inputs as values: `testsLoadingFromView` answers a list of paths with every test that loaded them, `testsEnteringFromView` answers ranges at `region-use`, `function-use` or `file-use`, and `routesFromView`, `testsDeclaringFromView`, `graphReachFromView`, `importersFromView`, `dependsReachFromView` and `readRowlessFromView` answer the other steps. `changeOfFiles` and `changeOfDiff` build the change they read, `ignoredChange` cuts it by a suite's `ignore`, and `narrowByChangeFromView` composes every step, as `narrowByExecution` does. No step reads git or the tree.
