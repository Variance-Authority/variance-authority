---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

A checkout's record moves onto a newer mainline record its HEAD contains

A checkout's record keeps a ledger beside it, `coverage.layer.json`: the mainline record it was laid on, and the test files its own runs observed with the commit and working tree each ran over. When `select` or `variance share --suite` reads a newer mainline record whose commit HEAD contains, the record moves onto it, and every test file this checkout did not run reads the newer one. A record of a commit HEAD does not contain changes nothing. The `record of "<suite>":` line names the mainline commit, the distance to HEAD, and the test files this checkout ran.
