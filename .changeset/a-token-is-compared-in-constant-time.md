---
'@variance-authority/tribunal': patch
---

The Node server compares bearer tokens in constant time

`variance-authority-tribunal` compared a presented bearer token with the ingest,
review and share tokens by string equality, which answers sooner the earlier a
guess differs. It now asks the Worker's own check, which hashes both tokens to
one length and compares every candidate without exiting early, so the response
time says nothing about how much of a guess matched.
