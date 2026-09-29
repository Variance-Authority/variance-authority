---
'@variance-authority/sense': minor
---

`journeysAmong` answers with the calls a chosen set of tests placed

The prepared journeys now keep which cases placed each call, not only how many. `journeysAmong(root, cases, suite)` takes cases by their position in the recording and returns every call those cases placed, counted among them, with how many cases placed it in all and how the call is known. Nothing is truncated. So a question that kept 15 of the 50 tests through a file maps what those 15 reach, and a call only the other 35 made is left out. Journeys prepared by an earlier walk are prepared again on the next `variance index`.
