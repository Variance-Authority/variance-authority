---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`distanceFromView` and `distanceByExecution` also place a test the record
holds incomplete and the diff did not enter, by the shortest import path it
ran to a changed file it loaded. So `distances` can hold a test outside
`narrowing.entered`. A test with no such path is left out of `distances`.
