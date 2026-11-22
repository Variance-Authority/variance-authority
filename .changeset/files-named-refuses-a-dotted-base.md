---
'@variance-authority/sense': patch
---

`filesNamed` refuses a base that holds a dot, as it refuses a slash or a glob character: no file's base holds one, so git is not asked for it.
