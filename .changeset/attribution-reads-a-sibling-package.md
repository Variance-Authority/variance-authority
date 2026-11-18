---
'@variance-authority/sense': patch
'@variance-authority/storybook-collector': patch
'@variance-authority/route-collector': patch
---

A collector's `source.dirs` reaches a sibling package again. Component attribution reads the checkout's source index, wherever in the checkout the collector runs, so `../other/src` and an absolute directory inside the repository are read and named from the working directory; only a directory outside the checkout is refused. When the index had to read a file to catch up, one line on stderr says so.
