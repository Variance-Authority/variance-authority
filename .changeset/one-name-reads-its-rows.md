---
'@variance-authority/help': patch
---

`symbol` and `uses` read the rows a name names. A question about one name used to turn every exported name of the workspace and every import written by path into objects before it kept a few dozen; it now asks the store's reader for the exports written under the name, the exports of the files they sit in, and the imports by path that take the name, and decodes those. On a workspace of 107,000 files `variance ask symbol --name mount --just-answer` answers in 0.72 s where it took 1.15 s, and `variance ask uses --name mount` in 0.55 s where it took 1.04 s. No answer changes.

`SearchIndex` gains `rows`, the reader those questions ask.
