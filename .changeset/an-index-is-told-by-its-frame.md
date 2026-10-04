---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

An execution index is told JSON or columns by its frame, not its first byte

A JSON execution index that opens on a tab, a carriage return or a byte order
mark now reads as JSON; it was taken for columns and refused as "not a
variance-authority execution index". `isEncodedExecutionIndex` now answers
true for bytes framed as a column file — a header length that fits and a JSON
header naming a version and its sections — whatever the low byte of that
length is, and otherwise looks for `{` past a byte order mark and JSON
whitespace.
