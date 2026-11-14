---
'@variance-authority/sense': patch
---

A cold scan reads and parses each TypeScript configuration once. The native scan read a configuration again for every package that extends it and for every setting asked of it, so a monorepo whose packages share one base paid for the base thousands of times. On Kibana (about 107,000 files, 1,529 configurations) the scan's own reader made 20,755 reads and now makes 1,529; a cold `variance index` spends about 5 s less CPU and its `reading every file` step is about 1.4 s shorter. The index holds the same rows.
