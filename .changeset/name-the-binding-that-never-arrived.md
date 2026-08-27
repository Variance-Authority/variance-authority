---
'@variance-authority/tribunal': patch
---

Name the binding that never arrived

`createBucketStore` and `createD1Backend` now refuse a `db` or `bucket` that is
not the binding it claims to be. A `wrangler.jsonc` declaring the database as
`D1` while the entry reads `env.DB` used to reach the first statement that
touched a row and surface as `Cannot read properties of undefined (reading
'prepare')` — a platform-shaped error for a configuration line — and a bucket
declared for production and not for a preview environment would have written
sidecar rows without the images they describe.
