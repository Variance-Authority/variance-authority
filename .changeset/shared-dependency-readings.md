---
"@variance-authority/sense": patch
---

Reduce dependency-lexicon preparation time and memory by sharing installed-file reads, parsed declarations and API values within each refresh. Digests use the same bytes that were parsed, while export traversal retains each entrypoint's package and cycle context.
