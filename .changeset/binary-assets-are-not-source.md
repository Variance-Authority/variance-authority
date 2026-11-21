---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

Exclude binary payloads from `ask grep` and `ask discover --text` results, including matches collected before binary data is detected. Keep BOM-encoded text searchable and apply the same rule to files read from disk or Git objects.
