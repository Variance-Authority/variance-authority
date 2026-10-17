---
'@variance-authority/playwright': minor
'@variance-authority/storybook-collector': patch
'@variance-authority/route-collector': patch
---

A run starts one Chromium. Harnesses and the renderer lease one browser per launch recipe and the last to close it closes it, so a Storybook or route run with four workers launches one browser instead of five. A Storybook run's workers also share one browser context, and with it the HTTP cache: a worker's preview boots from what the first page fetched instead of downloading the bundle again (at four workers on the storybook case, 75 fetches and 29 MB became 17 fetches and 6 MB).

New options: `createHarness({ warm })` opens the page in a context shared with other warm harnesses, `createHarness({ isolated })` launches a browser of the harness's own, and `observeNetwork(page, { cache })` watches the wire through the DevTools protocol with the HTTP cache left on (Chromium only). The `alone` reading in both collectors stays in a browser of its own.
