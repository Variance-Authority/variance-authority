---
'@variance-authority/help': patch
---

`ask search` shows an exported name where it is declared and where it is published from. A name a barrel passes on was shown at the barrel with `(+2 more files)`, which hid the declaring file; on Kibana, `ChatCompleteAPIResponse` read `inference-common/index.ts:8 (+2 more files)`. The row now names the declaration's file and line, then `· exported from` the barrel nearest its package's root that passes it on, `export *` included.
