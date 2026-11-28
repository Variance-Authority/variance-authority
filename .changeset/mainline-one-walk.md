---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A fetched mainline record is named only in its own commit's directory. The
name beside those directories now means only a read a run handed this checkout.
One walk in the native addon finds the kept records behind a commit, nearest
first, and stops at the last of them, for the pick, the fetch, the history view
and `ask symbol --line` alike, where two walks and two orders did before. A
leftover name beside the directories no longer keeps its record from the prune.
