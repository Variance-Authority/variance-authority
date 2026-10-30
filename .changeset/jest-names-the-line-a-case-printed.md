---
'@variance-authority/sense': patch
---

Under `VARIANCE_AUTHORITY_STORY=1`, Jest names the test's own line where a case printed, as it does without a story. The story hears the line where Jest's console writes it, not by wrapping `console.log`, so Jest no longer names the story's wrapper as the place it was printed.
