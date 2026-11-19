---
'@variance-authority/sense': patch
---

A configuration file is a file: an edit to a `package.json`, a lock file or a `tsconfig*.json` rebuilds no other file's record. Before, any byte in any of them rebuilt the whole index, so adding a `description` to one manifest cost what a cold scan does.

A configuration edit reaches other files through the edits that come with it: a new `paths` entry or `exports` subpath arrives with the files refactored to import through it, a moved target is a moved file, a new workspace package is new files imported by edited files, and a dependency bump moves no answer in your workspace. Each of these lands on the answers a cold index gives. Editing a mapping alone, to redirect code nobody edited, is not followed until that code is edited.

A `tsconfig` the scan cannot follow no longer makes every run cold whenever a file is added: it rebuilds nothing beyond its own record, and an import through a mapping it declared keeps its answer until the importing file is edited. The first update after upgrading reads every file once.
