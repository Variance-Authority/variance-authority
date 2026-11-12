---
"@variance-authority/cli": patch
---

`variance share --publish <records>` publishes a run of the whole suite as that run's record alone. It no longer lays the records over the mainline's last record, so a test file, a case or a reading only an earlier run held is not carried into every later record. The merge queue's publish of part of the suite (`--from-queue`) still lays its run over the mainline's record, since what it did not run stands where it last ran.
