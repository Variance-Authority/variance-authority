---
'@variance-authority/cli': patch
---

The `variance-testing` skill now starts a change from a failing test: `covering` finds the nearest test, the test is amended and seen to fail, and only then is the code edited. New code starts from a failing test too, beside the code that will call it, and `covering --since` moves to after the change, as the check of what it left unpinned.
