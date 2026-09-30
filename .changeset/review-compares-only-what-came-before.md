---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

`review --since` compares only the test files a run before this commit recorded

After a whole run into an empty cache and a selected run at the same commit, `review --since HEAD` reported every region the unselected files entered as gained: 231 on TanStack Query, 153 on Zod, where nothing moved. A run laid over no case index now names its files as having no base until a run at the commit runs them again, and `review` leaves them out of the comparison and lists them: "Not compared, no case of these was recorded before this commit's first run".
