---
"@variance-authority/sense": patch
---

Record configured custom Jest environments that import workspace modules before test setup. The host collector is installed before the environment loads, its CommonJS dependencies become test preconditions, and modules imported again inside a test retain their measured coverage. Environments without an observable dependency registry are refused instead of recording incomplete inputs as complete.
