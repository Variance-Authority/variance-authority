# Visual regression against a running application

Point it at URLs your app already serves. Nothing here knows or cares what
built them — swap `node server.mjs` for `next start`, `rails s`, or your own
dev server and the rest of this example is unchanged.

Two pages, each read at two widths.

## 1. Start the app and take the first look

In one terminal:

```bash
npm install
npx playwright install chromium
npm start
```

In another:

```bash
npx variance run
```

```
4 subject(s) observed, durable run at 2026-08-27T21:57:36.642Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
4 new

[new] plans@375: no baseline for `plans@375` under this renderer; nothing to compare against
[new] plans@1280: no baseline for `plans@1280` under this renderer; nothing to compare against
[new] seats@375: no baseline for `seats@375` under this renderer; nothing to compare against
[new] seats@1280: no baseline for `seats@1280` under this renderer; nothing to compare against
```

Exit code `1`. Two pages became four, because each width is watched on its own.
A page has a layout per breakpoint, and one that only checks the desktop one is
not checking the phone.

## 2. Approve what you see

```bash
npx variance accept plans@375 plans@1280 seats@375 seats@1280
npx variance run
```

Exit code `0`.

## 3. Break one breakpoint

`WIDE_COLUMNS` in [server.mjs](server.mjs) is how many plans stand side by side
once there is room for them. Change `3` to `2`, restart the server, and run
again:

```
3 unchanged, 1 changed

[changed] plans@1280: 7948 pixel(s) differ across 12 region(s), and the subject resized from 1280×224 to 1280×367
```

One subject out of four. The phone layout was a single column before your edit
and is a single column after it, so `plans@375` is reported as unchanged rather
than as noise you have to look through. The desktop page got a row taller,
which the run measured rather than left for you to notice.

## Why point at the server rather than at a build

Because a deployed application answers with its redirects, its headers and its
rewrites, and those are part of the page. A folder of files answers with what is
on disk. If your app is genuinely just files, [the static-site
example](../static-site) is the shorter path.

## What this path does not do

It does not name a component. `variance comment` will tell you the largest
changed region and say plainly that nothing was attributed:

```
1. **a region in main** — largest changed region in 1 subject, 2377px — no cause
   was named for it, so this is ranked by area, which ranks the displaced above
   the displacer
```

That is honest about server-rendered HTML: there is no component in the page to
point at. If you want the run to answer *which component changed*, give it
components to see — [the Storybook example](../storybook) does.

## What is where

| file | what it does |
|---|---|
| [server.mjs](server.mjs) | stands in for your application; ~50 lines, no dependencies |
| [variance/routes.mjs](variance/routes.mjs) | the URLs to read, and the widths to read them at |
| [variance.config.json](variance.config.json) | lists the two subject ids; the widths make four |
