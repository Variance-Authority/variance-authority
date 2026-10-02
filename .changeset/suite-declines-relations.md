---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

A suite may decline the import graph: `"relations": false` beside its `kind`.
A changed file its record measured is answered by the record, as before; one it
did not measure — a file added since the run, a stylesheet — is answered by the
first tests that import it, unless the suite declines relations, and then it
selects nothing in that suite. An end-to-end suite imports none of the app it
drives, so the graph names none of its tests; it lists what it rests on in its
own `before` instead. `variance select`, `select --execution` and `variance run
--since` name each declined file, and `select --json` carries them as
`declined`, apart from `unread`.

`narrowByExecution`, `narrowByJourneys` and `selectJourneyFile` take
`unmeasured: 'nothing'` to decline, and their narrowing carries `declined`
when they do. `unmeasuredOf(suite)` reads it off a declared suite.
