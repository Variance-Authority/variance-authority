---
'@variance-authority/sense': patch
---

`variance ask symbol` lists the members of an interface or class by looking its
one file up in each layer of the source index, where it merged every file record
of the index first. It finds a member's declarations by scanning each layer's
columns by dictionary id, without merging the layers, so that scan still grows
with the index rather than with the answer. On a workspace of 107,000 files,
`ask symbol --name mount --just-answer` spends about 40 ms on its members where
it spent about 145 ms. No answer changes.
