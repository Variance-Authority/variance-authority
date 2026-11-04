---
'@variance-authority/cli': patch
---

The `variance-testing` skill now starts a change from a failing test: `covering` lists the candidates, you choose the case whose assertion states the required behaviour, that case is amended and seen to fail, and only then is the code edited. Behaviour the change does not touch is pinned green; an assertion on the behaviour being changed is amended, never pinned. New code starts from a failing test too, beside the code that will call it, where a failure at import, compile, collection or the first call is the red state, and `covering --since` moves to after the change, as the check of what it left unpinned.
