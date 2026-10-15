---
'@variance-authority/tribunal': patch
---

A crop and the viewer say `aria-busy` while their image is still being made

When a build keeps no difference mask, the review page makes one from the two
captures after both have arrived, and draws it from an object URL. Nothing is
on the wire while that runs, and no image node exists yet, so a screenshot or a
test taken then read a crop with an empty frame. A crop now carries
`aria-busy="true"` until it knows whether it is near the screen and, once it is, until
its mask is made or has failed; the viewer carries it while its mask is being
made. Wait for no `[aria-busy="true"]` on the page before you read it.
