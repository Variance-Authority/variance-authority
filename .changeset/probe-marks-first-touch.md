---
'@variance-authority/sense': patch
---

A recorded test run spends less time in instrumented code

The probe in each instrumented region now sets one flag the first time a test
runs the region, where it used to increment a counter on every run. A hit costs
1.2 to 3.2 ns, down from 2.6 to 4.4 ns. Recordings are byte-identical to the
ones earlier versions wrote.
