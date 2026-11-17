---
'@variance-authority/sense': minor
---

A page that calls `reportPage` tells its story under Vantage when its build ran with `VARIANCE_AUTHORITY_STORY=1`: the build plugin, under Vite, webpack or Rspack, reads the variable and serves the collector with the page's tape and a teller beside it. Each load, click or submit is told once the page runs nothing more for it, at the next click, or as the page leaves, so `variance ask ran --story` prints a `head page` with the functions it entered, what each was handed, and the page's own notes: `console` lines, Suspense fallback and unlock, paint, long frames and layout shifts. The requests it sent are not in it. Without the variable the collector is served as before.
