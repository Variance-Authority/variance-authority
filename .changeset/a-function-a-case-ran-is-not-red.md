---
'@variance-authority/cli': patch
---

A changed function a case ran is no longer counted under 🔴 in the review's package table

A function a case entered, with a branch no case took, was counted under 🔴 in
**Where this change lands**, whose legend reads *no case ran it*, while the
table of what ran gave the same function 🟡 or 🟢. The package table now marks
each function as that table does, by the nearest test that entered it, and a
new column counts the functions holding code no case ran: the ones no case
entered and the ones with a branch no case took. In `review.json`,
`changedPackages[].reaches` counts each function by its own region, and
`changedPackages[].uncovered` counts the ones holding code no case ran.
