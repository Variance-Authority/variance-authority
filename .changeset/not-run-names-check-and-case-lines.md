---
'@variance-authority/help': minor
---

`variance ask not-run` names each declared check a passing attempt did not enter with the line of its case and the line of its check, and the attempt when the case ran more than once; it lists the test files where the runner did not end an attempt, and names no check of theirs. The run's scope line is gone. A run that began after the checks landed and has not landed its own — killed, or still running — names no check either, under any runner, and says when it last wrote.
