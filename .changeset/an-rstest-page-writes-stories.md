---
'@variance-authority/sense': minor
---

Rstest browser mode writes test stories

With `VARIANCE_AUTHORITY_STORY=1`, a case that runs in a page under Rstest's
browser mode writes its story, and `variance story` reads it as it reads a
case's in Node: the code the page ran in order, what it printed, and the test
line each step started at. Each case is named as it is in Node, by its file and
its describe path.
