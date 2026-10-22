---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

Store last-run case membership as references to the record's case index, reducing records with long case names while preserving exact membership across partial runs and shard folds. Existing records remain readable.
