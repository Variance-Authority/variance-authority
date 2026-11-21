---
'@variance-authority/sense': patch
---

A doc comment's inline tag name — `code` in `{@code x}`, `link` in `{@link x}` — is no longer read as a word of the doc, so `variance ask search --query "code layers"` no longer answers with a Javadoc that only writes `{@code <layer>}`.
