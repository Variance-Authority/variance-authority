---
'@variance-authority/sense': patch
---

The case index a run lays into its record is folded by the native addon: the
addon reads the run's case journals, joins a case written twice, and lays each
case's regions, lines, statement times, durations and limits in one pass. On a
4,500-case Vitest run the fold falls from about 300 ms to 140, so the process
exits that much sooner after the run summary. The JavaScript fold is gone:
without the addon, recording a run's cases throws and names why the addon is
absent.
