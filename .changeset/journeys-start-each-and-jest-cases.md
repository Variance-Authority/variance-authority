---
'@variance-authority/sense': patch
---

A case's journey and its declared checks start from the same body, found the same way: the one whose describes and title spell the case's name (joined by ` > `, or by Jest's space), then one with its last title, then a template that may have formatted it. A body handed to a curried `.each` — `it.each(table)(title, fn)` or a tagged table — is now a test body, so an `each` case starts from it rather than from its file.
