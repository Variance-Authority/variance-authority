---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

Keep exact-name classification focused on its direct questions

`variance ask classify` skips lexical area ranking when every query word is
recognized and no `--from` or `--to` is supplied. Package, entrypoint and export
follow-ups remain available. Queries with unrecognized words and explicit start
points retain area ranking.
