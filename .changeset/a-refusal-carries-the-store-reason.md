---
'@variance-authority/core': patch
---

`httpLineCell` reads a 4xx answer as `refused`, not only 401 and 403, because every 4xx is the store saying no: a key it will not hold, a path it does not route, a token it does not take. The detail carries the store's own reason when the body gives one, as the `error` of a JSON body or as plain text, on one line and at most 1000 characters: `<url>: HTTP 422: the object key … names "feature" …`. A 404 is still `absent`. 408, 429 and every 5xx are `unreachable`, because they say the store could not take the request now, and they carry the reason the same way.
