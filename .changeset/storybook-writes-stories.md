---
'@variance-authority/sense': patch
'@variance-authority/storybook-collector': patch
---

Under `VARIANCE_AUTHORITY_STORY=1`, a Storybook run with `tests` on writes each story's test story: the code the preview ran for it, in order, with what it printed. A story read twice, in the shared world and alone, is one story.
