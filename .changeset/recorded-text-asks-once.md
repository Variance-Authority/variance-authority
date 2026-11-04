---
'@variance-authority/sense': patch
---

`textAtRecording` stops asking git the same paths over and over on a branch far
from the record's commit. A reader holds, for each commit and for as long as it
lives, what it read alone and what a window read for the second time, a path the
commit does not hold included. At a commit a path no window read reaches git once
and one a window read at most twice. Nothing bounds what is held, so the window's
limit now covers only a first read.

A path git refused now fails again when it is asked again, where a path from a
refused window used to read as absent the second time.
