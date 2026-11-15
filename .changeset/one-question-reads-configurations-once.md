---
'@variance-authority/sense': patch
---

One question reads the workspace's tsconfig and jsconfig files once. `variance
ask symbol` followed each declaration of a name and, for each one, found and
parsed every configuration again to tell which unresolved imports could take
it; it now reads them once per answer. On Kibana, `ask symbol --name mount`
drops from 3.0 s to 1.8 s, and `docs_symbol` to a warm help server from 2.1 s
to 0.9 s.
