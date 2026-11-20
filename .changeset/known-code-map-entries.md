---
"@variance-authority/sense": patch
---

Reduce cold code-map preparation time by carrying the index update's file inventory into the existing resolver and grouping wildcard candidates by their owning package. In a directory Git lists, the map now finds a package's `tsconfig.json` the way the index update does: a config Git ignores there no longer declares outputs or paths for the map.
