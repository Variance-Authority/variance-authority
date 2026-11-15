---
'@variance-authority/sense': minor
---

A selected Jest run transforms, before its workers start, every file the record
says its selected tests load, through the project's own transformer and in
parallel across `maxWorkers`. A test that requires a module inside a case or a
hook then reads it from Jest's cache instead of transforming it on its own time.
A run with no selection, no record, or a file the record does not name is
transformed as Jest transforms it.
