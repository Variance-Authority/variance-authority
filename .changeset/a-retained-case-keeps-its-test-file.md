---
'@variance-authority/sense': patch
---

A test file whose cases were retained keeps the regions they reach

A review that did not run a test file keeps that file's cases from the base, and
a region already counted them as reaching it. The test files that moved were
counted from the cases that ran alone, so a file that did not run was reported as
no longer entering every region its retained cases still reach. A test file now
moves by the same cases a region does, so a file that did not run moves only
where its retained cases stop reaching.
