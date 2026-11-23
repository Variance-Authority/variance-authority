---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

Make `ask classify` read the published source snapshot for file-name matches,
declarations and area ranking. Classification no longer lists live Git paths
or rereads manifests for discarded metadata, and never refreshes the index.
Run `variance index` explicitly when a new snapshot is needed.

Mark identifiers whose snapshot lookup was unavailable as not looked up, rather
than claiming they name nothing.
