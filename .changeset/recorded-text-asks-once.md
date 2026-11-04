---
'@variance-authority/sense': patch
---

`textAtRecording` stops starting a git process for what it reads. Its reads go to
one `git cat-file --batch` the addon leaves open, so a selection that asks the
same paths in jumps, for hours on a branch far from the record's commit, starts
no process per ask, whichever order it asks in.

A reader holds the answers asked most recently, a path the commit does not hold
included, up to 8 MB of what the process spends on them, and nothing nobody asked
for. While everything asked fits, a path at a commit reaches git once. Past it, a
path reaches git again when more than 8 MB of other answers were asked since it
was last asked, and a text over 8 MB reaches git at every ask.

A path git refused fails again when it is asked again, where a path from a
refused window used to read as absent the second time.
