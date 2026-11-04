---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`variance ask uses --name` keeps naming every exported namesake of a published name after a second `variance index`, where it used to lose them on any run that found the same exported names. The snapshot's version moves, so a value a refresh wrote without them is read again.
