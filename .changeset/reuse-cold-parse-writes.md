---
'@variance-authority/sense': patch
---

Cold source indexes avoid hashing and writing the same encoded parses twice. On macOS, the root index clones the files already written to its shared parse store while retaining independent files for each index.
