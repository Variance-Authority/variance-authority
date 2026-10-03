---
'@variance-authority/cli': patch
---

Reading the mainline's record no longer throws when the daily prune of the
cache is due and finds something to remove. `variance review`, `select`,
`coverage`, `share --suite` and the `suiteBase` export failed with `Cannot read
properties of undefined (reading '0')` on the first fetch of the day whose prune
removed an entry or failed to. The record note that `variance select` and `share --suite`
print now ends with what the prune took, in the words `variance prune` uses,
such as `cache: freed 8.0 MiB in <cache>: 1 directory nothing writes any more`.
