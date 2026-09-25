---
'@variance-authority/cli': minor
---

`variance reach --whole-files` walks from every changed file whole without reading the edit, which is the list a file-by-file import graph gives. It is never shorter than the default list, so running both shows what the reading left out. Its JSON has no `quiet` and no `exports`, because no edit was read.
