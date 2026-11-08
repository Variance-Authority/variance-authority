---
'@variance-authority/mcp': patch
---

A start point such as `--from packages/help` that names a folder without its
trailing slash is read as that folder when no file has that name, instead of
answering that the path is not found.
