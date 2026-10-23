---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

Each stage of test selection can be asked alone, over an open record and with its inputs as values: `testsLoadingFromView` answers a list of paths with every test that loaded them, `testsEnteringFromView` answers ranges at `region-use`, `function-use` or `file-use`, and `routesFromView`, `testsDeclaringFromView`, `graphReachFromView`, `importersFromView`, `dependsReachFromView` and `readRowlessFromView` answer the other stages. `changeOfFiles` and `changeOfDiff` build the change they read, `changeOfPaths` cuts it to some of its files, `ignoredChange` cuts it by a suite's `ignore`, and `narrowByChangeFromView` calls the same stages in order, as `narrowByExecution` does, so a stage asked alone answers as it does inside the whole. No stage reads git; the checkout is read only through `root`. A change that names lines and no hunks is charged by its lines: no parser reads it, and no declaring test counts as having run the text it arrives at.
