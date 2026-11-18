# Reviewing `@variance-authority/page-broker`

## Contracts

Written in [README](README.md) and pinned by
[src/action.chromium.test.ts](src/action.chromium.test.ts), over a page that
announces nothing.

- **It stands on Playwright alone.** It imports nothing from the rest of
  Variance Authority, and Playwright as types only. It is no part of
  `@variance-authority/playwright-test` or `@variance-authority/playwright`,
  and neither depends on it.
- **The app announces nothing.** No `aria-busy`, no announced event, no
  attribute written for a test is read. An arrival is a declared part of the
  page becoming visible.
- **Staying is never reported early.** It needs the act finished and no request
  in flight for the quiet period, and a declared part that appears first wins.
- **The order of a declaration decides nothing.** Two declared parts visible at
  once fail; neither is picked.
- **An outcome on the page before the act is refused**, since reaching it could
  not be told from standing still.
- **A failure names the action and the declared outcome reached**: `expected X,
  reached Y`, or the outcomes none of which was reached. An arrival at something
  not declared is not named: with `stay` declared it reads as staying.

## What it does not answer

When an action may start, what else is on the page, and whether a part that
left is gone. Each is a separate question, and none is answered by reading a
signal the app must be changed to give.
