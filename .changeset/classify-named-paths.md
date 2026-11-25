---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask classify` and `docs_classify` look up the files a request spells: a path
from the workspace's root, and a file's name with its extension, each listed
with what the file declares. A path that is no indexed file still names none.
