---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

The dependency lexicon is merged on every edit, not only the first since the index was readied. Each update after the first rewrites the index's working layer rather than appending to it, and the merge took that for a chain it could not follow, so it read every source file, resolved every dependency and re-hashed every declaration again. `variance index` now says when the lexicon was merged.
