---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

A checkout that is renamed or moved with its cache inside it keeps its recording: `variance covering` and `variance select` still read it there, and a prune leaves it. The cache names a checkout by its path as seen from the cache directory, where it named it by its absolute path. A recording written before this release is not carried over, so the first run after the upgrade records afresh, and the directory the old recording sits in stays until you delete it or its checkout is gone.
