---
'@variance-authority/tribunal': patch
---

`createDirectoryBucket` compares every segment of a key with the name the volume stores, not only the file name. On a volume that treats two spellings as one name, such as the default APFS on macOS, a key that finds an existing file or directory only through a spelling it does not use is absent: `get` and `head` answer `null`, `delete` removes nothing, and `put` throws an error that names the segment and the stored spelling. So two share lines whose branches differ only by case, such as `branch/Feature` and `branch/feature`, are two lines on a case-sensitive volume, and on a folding volume the second one is refused instead of reading and replacing the first. The check costs up to two `lstat` calls for each segment that exists, and on a folding volume one `realpath` more.
