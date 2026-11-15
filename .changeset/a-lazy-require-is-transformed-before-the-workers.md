---
'@variance-authority/sense': minor
---

A selected Jest run transforms, before its workers start, the files the record
says its selected tests load late: inside a case or a hook, after their first
case began, as a `require` in a test body or SWC's `module.lazy` does. It runs
them through the project's own transformer, in parallel across `maxWorkers`, so
the case that requires one reads it from Jest's cache instead of transforming it
on its own time. A file a test loads at import is left alone, and a run whose
tests load nothing late starts no worker. A project that treats files as ES
modules, an `.mjs` test, coverage over only the changed files, a run with no
selection or no record, and a file the record does not name are transformed as
Jest transforms them.
