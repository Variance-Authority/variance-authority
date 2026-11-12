---
'@variance-authority/cli': minor
'@variance-authority/core': minor
---

A push to a mainline can publish its merge queue's record of the same commit as soon as it lands. `variance share --publish --from-queue <artifact pattern>` finds the latest green `merge_group` run of the running workflow that tested `HEAD`, downloads its matching artifacts, folds them over the mainline's record and publishes the result marked partial. The whole run's publish at the same commit replaces a partial entry, and a partial publish keeps a whole one, saying so.
