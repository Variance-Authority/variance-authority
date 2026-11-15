---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

One question opens the source index once. `variance ask symbol` and `variance
ask search` about a name declared in many files read, checked and opened every
segment of the index again for each declaration they followed; they now do so
once per answer, however many readers the answer asks. On Kibana, `ask symbol
--name mount` drops from 5.3 s to 2.9 s, `ask search --query mount` from 1.1 s
to 0.56 s, and `docs_symbol` to a warm help server from 4.1 s to 2.0 s.
