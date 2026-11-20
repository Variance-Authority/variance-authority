---
'@variance-authority/sense': patch
---

Publishing the questions holds each search term once

`variance index` publishes the questions' store with each search term's text held once and every row's terms as ids, cut and lowered a batch of rows at a time. Before, it held every row's terms and lowered doc as strings at once. On an M4 Max, a cold `variance index --wait` over the corpus `packages/sense/scripts/monorepo-corpus.mjs` generates with `--packages 16000 --files 4` peaks at 3.8 GB resident where it peaked at 4.5 GB, and with `--packages 1000 --files 94` at 4.0 GB where it peaked at 5.3 GB; the publish step took up to 0.3 s longer on the second. The store is byte-identical.
