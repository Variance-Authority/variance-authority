---
'@variance-authority/sense': patch
---

`textAtRecording` stops starting a git process for a text it reads. A text, and a
path the commit does not hold, come from one `git cat-file --batch` the addon
leaves open, so a selection that asks the same paths in jumps, for hours on a
branch far from the record's commit, starts no process for them, whichever order
it asks in. A git-LFS pointer's content and a read git refuses start processes
each time they reach git.

A reader holds the answers asked most recently, a path the commit does not hold
included, up to 8 MB of text, and nothing nobody asked for. The bound is on that
text: the open process's memory is git's, and it stays until Node exits. While
everything asked fits, a path at a commit reaches git once. Past it, an answer
goes when it and what was held after it no longer fit 8 MB, and the next ask for
it reaches git again. A text over 8 MB is never held: it reaches git at every
ask, and lets go of nothing.

A path git refused fails again when it is asked again, where a path from a
refused window used to read as absent the second time.
