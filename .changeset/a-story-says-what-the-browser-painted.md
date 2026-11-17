---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
---

A story recorded in a Chromium page says what the browser painted, held and moved

With `VARIANCE_AUTHORITY_STORY=1`, a page a Playwright spec drives notes what the browser reported of its frames after the step it followed: `first paint`, `largest paint: h1.title`, `held a frame (121 ms)` for a frame a script held past 50 ms, and `layout moved 0.25`. Each is placed by the time the browser gives it; a report that arrives after the line's statement ended is told on the next line. A browser that reports some of these types but not others names the rest once, as `unseen here: long-animation-frame`. The notes are for reading: `variance story --compare` leaves them out, since their timings and place change from run to run.
