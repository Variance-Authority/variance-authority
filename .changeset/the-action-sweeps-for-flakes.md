---
'@variance-authority/cli': minor
---

The action takes `flakes: 'true'`, which runs `variance run --flakes`: every
subject is read twice, whatever its verdict, and the check is red when one read
differently twice. A nightly sweep is one action step on a `schedule`, with
`comment: 'false'` and `report-page: 'true'`, after the setup the pull-request
job already has.
