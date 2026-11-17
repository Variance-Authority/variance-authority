---
'@variance-authority/playwright-test': minor
'@variance-authority/playwright': minor
'@variance-authority/cli': patch
---

A Playwright story names the requests each line of the spec sent, each answer
that came back on it with its status, and what was still out when the line
ended, by method and path alone: `sent POST /api/order, GET /api/price`,
`POST /api/order 201`, `still out GET /api/price`. The query and the body are
never written. `@variance-authority/playwright` exports `awaitedRequest`, the
test both its arrival watch and the story apply to what a page sends.
