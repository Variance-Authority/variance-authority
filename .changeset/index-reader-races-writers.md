---
'@variance-authority/sense': patch
---

A source index read while other processes write it is no longer reported as damaged. A reader that finds a segment missing follows the manifest the writer left; when writers keep moving it, the reader answers from the older whole generation it read instead of rebuilding. Only a segment missing under a manifest that stayed put counts as damage.
