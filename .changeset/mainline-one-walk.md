---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A fetched mainline record is named only in its own commit's directory. The
name beside those directories now means only a read a run handed this checkout.
One walk finds the kept records behind a commit, nearest first, for the pick,
the fetch and the history view alike, where two walks did before.
