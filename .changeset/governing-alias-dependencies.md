---
"@variance-authority/sense": patch
---

Bound each indexed file’s alias dependencies to the TypeScript configuration its resolver selects. Large monorepos no longer multiply every import’s directory witnesses by unrelated configurations, preventing the resulting memory exhaustion with default settings. Scans, cold indexes and incremental updates share the same resolver-owned candidates; disabled TypeScript configuration contributes none.
