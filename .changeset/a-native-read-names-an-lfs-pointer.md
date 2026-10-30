---
'@variance-authority/sense': patch
---

The source index and journeys no longer read a git-LFS pointer as source. A file git holds as a pointer is read from the checkout that smudged it, and a checkout that holds the pointer itself fails the file with the reason and the commands that fetch it. Journeys read the text at the recorded commit through `git lfs smudge`, and fail with git-lfs's own words when it cannot give it.
