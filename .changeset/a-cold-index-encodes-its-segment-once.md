---
'@variance-authority/sense': patch
---

A cold index encodes its segment once, with its listing, rather than encoding it and then carrying the listing into a copy. A listing carried into a segment keeps the segment's column order, so the same segment carried twice is the same bytes. The listing names the symlinked directories it could not hash in code-unit order, so two listings of the same tree write the same bytes.
