---
'@variance-authority/storybook': minor
---

A story is ready only when Storybook says so. The markup-quiescence fallback is gone, and with it the `markup-quiescent` readiness: markup that stopped changing cannot see a story still waiting on a fetch, a font or an image. The story the URL selected is read from Storybook's `currentRender`, so one still loading or playing is waited for rather than called `already-rendered`. A story with no `storyRendered` within `timeoutMs` is a `timeout` naming it, and a preview with no Storybook channel refuses every story unless `readySelector` is configured.
