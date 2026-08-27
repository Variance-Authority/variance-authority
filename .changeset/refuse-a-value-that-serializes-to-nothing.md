---
'@variance-authority/core': patch
---

Refuse a value whose state is not in its own enumerable keys.

`shapeValue` documented a `Date` as refused and encoded it instead. `typeof`
answers `object`, `Object.entries` answers empty, and the canonical text came
out `{}` — so a snapshot holding a timestamp addressed to the digest of an empty
object, and a later run comparing a different timestamp reported unchanged. The
same hole swallowed `Map`, `Set`, `URL`, and `RegExp`.

An object with no own enumerable keys and a prototype other than `Object`'s is
now refused by name at its pointer. A genuinely empty object is still a value,
and an instance carrying its own fields still serializes them.
