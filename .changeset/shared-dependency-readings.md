---
"@variance-authority/sense": patch
---

Reduce dependency-lexicon preparation time by reading and parsing each installed declaration file once per refresh, where every entrypoint of an install used to read it again. An install's readings are held only until its last importing manifest is read, and keep only what the export walk uses, so peak memory grows by at most one install's declarations per thread. Digests use the same bytes that were parsed.
