---
"@variance-authority/sense": patch
---

Reduce dependency-lexicon preparation time by reading and parsing each installed declaration file once per refresh, where every entrypoint of an install used to read it again. One thread reads all of an install's importing manifests in turn and drops its readings when it moves on, so the extra memory is at most one install's declarations per thread. Digests use the same bytes that were parsed.
