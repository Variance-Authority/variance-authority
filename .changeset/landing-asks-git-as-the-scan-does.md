---
'@variance-authority/sense': patch
---

Landing a run asks `git status` which files moved in the same shape the scan asks it, so a checkout with git's untracked cache turned on answers from the cache instead of reading every directory again. On a 41,000-file checkout with the cache in its index, the question takes about 53 ms instead of 100 ms. The texts a landing keeps are unchanged.
