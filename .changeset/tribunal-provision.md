---
'@variance-authority/tribunal': minor
'@variance-authority/cli': patch
---

`variance-authority-tribunal-provision` sets up a Cloudflare tribunal in one idempotent command. It creates the D1 database and the R2 bucket, applies the migrations, and puts Access in front of the review pages with the bearer paths bypassed. It writes `database_id`, `account_id`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` into `wrangler.jsonc`. It mints `INGEST_TOKEN` into the Worker and the repository's `VARIANCE_INGEST_TOKEN` secret without printing it. The `variance-authority` skill routes tribunal setup to it.
