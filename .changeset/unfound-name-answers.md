---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask symbol` and `ask uses` answer a name nothing declares on stdout and exit `0`, instead of refusing on stderr. The answer says what was read and declares nothing, where else the name may be written, and that a text search such as `rg` finds a name written only in a string or a comment. `variance-authority-help` answers the same way.
