---
'@variance-authority/sense': patch
---

The sense addon now lays a run's case readings over the record in one native call, and the JavaScript lay is gone. On TanStack Query's suite, the lay took about 1.5 s of the main process's time and now takes about 130 ms. A machine without the addon now gets an error naming why the addon is missing, where before it fell back to the slower JavaScript lay.
