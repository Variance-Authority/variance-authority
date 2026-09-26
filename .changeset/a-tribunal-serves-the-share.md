---
'@variance-authority/tribunal': minor
'@variance-authority/cli': patch
---

A tribunal serves the share under `/share/`, so an `http` share whose `endpoint` is `<deployment>/share` stores its lines there. The ingest token reads and writes it. The new optional share token (`shareToken`, `SHARE_TOKEN` on Cloudflare, `VARIANCE_TRIBUNAL_SHARE_TOKEN` for the Node executable) only reads it and is refused everywhere else. The review token is refused under `/share/`. A manifest is replaced only on the version it was read at, so two writers publishing to one line keep both sets of entries. `createTribunalRoutes` exports `PUT`, and `authorize` may return `'share'` when `tokens.share` is set. `R2Like.put` takes R2's `onlyIf` and returns the written object's `httpEtag`. The API version is 3, and `variance push` says a deployment at API 2 answers 404 under `/share/`.
