# Visual regression from a unit test

The subject is a component you mounted yourself, in a test, with props you set.
No route to build, no story to write, no server to start — the test already
constructs the state, so watching it costs one more line.

Two states of one badge here, and the second one is the interesting kind: an
error tone that a page only shows once something has gone wrong.

## 1. Take the first look

```bash
npm install
npx playwright install chromium
npm test
npx variance run
```

```
2 subject(s) observed, durable run at 2026-08-27T22:18:59.445Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
2 new

[new] badge/neutral: no baseline for `badge/neutral` under this renderer; nothing to compare against; the collection of this subject reported unverified-fonts (warn) ×2, portals-not-resolved (warn), so what was compared may be less than the whole subject
[new] badge/urgent: no baseline for `badge/urgent` under this renderer; nothing to compare against; the collection of this subject reported unverified-fonts (warn) ×2, portals-not-resolved (warn), so what was compared may be less than the whole subject
```

Exit code `1`. Nothing has been approved yet, so there is nothing to compare
against.

The tail on each line is this suite's standing limits, repeated per subject: the
badge is styled with a system font stack, which is a different font on your
machine than on CI, and nothing here declared a portal target. Both are true of
every subject in every run of this example, and neither holds the run open.

`npm test` ran the badge's ordinary assertions and, one line further down each
test, wrote down what the badge looked like. `variance run` is a separate
command reading what the tests left behind — it does not run your tests and your
tests do not wait for it.

## 2. Approve what you see

```bash
npx variance accept badge/neutral badge/urgent
npx variance run
```

```
2 unchanged
```

Exit code `0`.

## 3. Change one colour

Give the urgent badge a darker border — `border: '#d08b8b'` to `'#8a2020'` in
[src/badge.js](src/badge.js) — then run the tests and the comparison again:

```bash
npm test
npx variance run
```

```
1 unchanged, 1 changed

[changed] badge/urgent: 145 pixel(s) differ across 1 region(s); the collection of this subject reported unverified-fonts (warn) ×2, portals-not-resolved (warn), so what was compared may be less than the whole subject
```

The neutral badge held. One tone changed and only that tone is reported, which
is the whole reason to capture the states separately rather than a page that
happens to contain one of them.

## 4. Put it on the pull request

```bash
npx variance comment
```

```
## Visual variance — 1 subject(s) need review

playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x) · durable retention · 2026-08-27T22:19:08.943Z

### Causes

1. **a region no box contained — usually a wrong scale or origin, not a component** — largest changed region in 1 subject, 145px — no cause was named for it, so this is ranked by area, which ranks the displaced above the displacer
    seen in `badge/urgent`
```

It prints nothing at all when the run is green.

A run and a comment both print more than is shown here — what each one had to
hold still, and what it could not measure. The lines above are the ones you act
on.

## Why a browser still starts

`"profile": "jsdom"` in [variance.config.json](variance.config.json) says where
the capture is *taken*, not where it is painted. Your tests stay in jsdom and
stay fast — 638ms for this suite, no browser in the loop — and a single browser
starts later, once, in `variance run`, after every test has finished. You write
no browser code and no test waits for one.

## Why the captures are cleared first

[variance/reset.mjs](variance/reset.mjs) empties the capture directory once
before the suite, from Vitest's `globalSetup`.

A capture is addressed by its subject id, so two tests that both call themselves
`badge/urgent` address one file. That is worth an error rather than a silent
overwrite — a run reading the directory afterwards would otherwise be quietly
missing a subject — and it is only worth an error over a directory holding a
single run. `resetCaptures` is what makes it hold a single run. Without it the
second `npm test` fails, correctly, and about the wrong thing.

## What this path does not do

It does not name a component. The badge is a `span` built by
`document.createElement`, so there is nothing above the node to attribute a
change to, and the report says so rather than guessing:

```
no component named in 2 subject(s) — these subjects carry no component provenance, so a change in them can be located in the image but not attributed to what rendered it
```

For `Button changed and here is the line`, watch components where a component
boundary exists — see the Storybook example.

## What is where

| file | what it does |
|---|---|
| [test/badge.test.js](test/badge.test.js) | an ordinary test, plus the line that captures |
| [variance/reset.mjs](variance/reset.mjs) | clears last run's captures, once per run |
| [vitest.config.js](vitest.config.js) | ordinary Vitest config, plus that setup file |
| [variance.config.json](variance.config.json) | reads the directory the tests wrote to |
| [src/badge.js](src/badge.js) | one component, two tones |
