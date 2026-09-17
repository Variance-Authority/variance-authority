# Waiting on a decision instead of on a repaint

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at.

This case exercises one part of it that compares no images,
[`@variance-authority/event`](../../packages/event/README.md). An
**announcement** is a call the application source makes at the moment it decides
something: three coordinates — `location`, `subject`, `action` — and no payload.
It says *when*, never *what*. A test names the same three coordinates back and
waits for the call, rather than waiting for the screen to change.

What this case demonstrates is that the branch where nothing is drawn becomes
assertable, in a real browser, against a real HTTP service, through the actual
Playwright Test CLI — not a harness written to make the point.

The application decides whether to show a modal only after a request whose
latency varies by hundreds of milliseconds — the kind of wait that makes a
screen-only assertion pass or fail depending on the machine. The consumer specs
never name a duration. They wait for the decision to be announced, then assert
the screen once, with polling switched off (`timeout: 0`).

## Run it

From the repository root, once:

```bash
yarn install
yarn build
npx playwright install chromium
```

Then, still from the repository root:

```bash
yarn vitest run cases/event-announcement-case/src/workflow.chromium.test.js
```

Without a Chromium binary the file skips and prints the install command. It
takes about eight seconds because it launches two real Playwright runs:

```
 RUN  v2.1.9 /path/to/variance-authority

 ✓ cases/event-announcement-case/src/workflow.chromium.test.js (2 tests) 7338ms
   ✓ a decision announced across two processes > settles every wait with no
     duration written anywhere 2817ms
   ✓ a decision announced across two processes > says what it heard when a wait
     does not settle 4519ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  7.76s
```

Two Vitest tests, because what is asserted is what two Playwright processes
exited with and printed. The detail is in those processes.

## The files

| File | What it is |
| --- | --- |
| [`src/server.mjs`](src/server.mjs) | The application and the service behind it. Serves the page, answers `/api/decide` after 60–560ms, and announces from both sides. The browser is served the package's own built module, not a copy. |
| [`src/playwright.config.mjs`](src/playwright.config.mjs) | Four workers, `fullyParallel`, `reporter: 'list'`, and the `webServer` entry that starts `server.mjs`. |
| [`src/spec/announcement.spec.mjs`](src/spec/announcement.spec.mjs) | The twelve consumer tests. Ordinary `@playwright/test`, extended with `varianceFixtures`. |
| [`src/spec/diagnosis.spec.mjs`](src/spec/diagnosis.spec.mjs) | Two tests written to fail. What is under test is what they print. |
| [`src/workflow.chromium.test.js`](src/workflow.chromium.test.js) | The outer Vitest file: orchestration only. It launches the Playwright processes and reads what they printed. |

## What the passing run shows

The first Playwright process runs the twelve tests in
`src/spec/announcement.spec.mjs`:

```
Running 12 tests using 4 workers

  ✓   3 announcement.spec.mjs:22:1 › without the announcement the negative passes for the wrong reason (115ms)
  ✓   5 announcement.spec.mjs:37:1 › the service behind the page announces too (226ms)
  ✓   4 announcement.spec.mjs:16:1 › the branch that draws nothing is assertable too (345ms)
  ✓   1 announcement.spec.mjs:30:1 › a process can be waited to its end (479ms)
  ✓   2 announcement.spec.mjs:10:1 › the branch that draws a modal is assertable on the first run (475ms)
  ✓   7 announcement.spec.mjs:52:3 › concurrent execution 1 hears its own request and no other (447ms)
  ...
  12 passed (2.6s)
```

Three of those are worth opening the file for:

- *without the announcement the negative passes for the wrong reason* asserts
  the modal is hidden on the run where it is about to appear, and passes. That
  pass is the finding: the same assertion passes on both branches, so a suite
  records a result on a branch it never observed.
- *the service behind the page announces too* waits on `pricing / upsell /
  quoted`, announced inside the Node process serving the request — not in the
  browser.
- Six concurrent executions run against that one service process, and each
  asserts it heard exactly one `quoted`. Announcements are attributed per
  execution, so a parallel worker does not hear its neighbours.

## What a wait that never settles says

`src/spec/diagnosis.spec.mjs` exists to be read, not to pass. The second
Playwright process runs it, expects exit code 1, and asserts the message. That
message is the product when a wait does not settle, so it is asserted like one.

Coordinates that drifted — the spec waits on `decidd`, a typo:

```
  1) src/spec/diagnosis.spec.mjs:8:1 › diagnosis of coordinates that drifted

    Error: `checkout / upsell-modal / decidd` was never announced within 2000ms
    Announced in this execution, in order:
      page  checkout / upsell-modal / deciding (start)
      pricing  pricing / upsell / quoting (start)
      page  checkout / upsell-modal / decided
      page  checkout / upsell-modal / deciding (end)
      pricing  pricing / upsell / quoted
      pricing  pricing / upsell / quoting (end)
```

The list prints in arrival order and interleaves both announcing processes — the
column on the left is where the call was made, `page` or the service — so the
mistyped action is visible against its neighbours.

Nothing announced at all — the spec never loads the page:

```
  2) src/spec/diagnosis.spec.mjs:13:1 › diagnosis of a run where nothing announced

    Error: `checkout / upsell-modal / decided` was never announced within 500ms
    Nothing was announced at all, by any realm. Either no listener is installed
    for this execution, or the code that decides does not call `vae` yet — a
    wait cannot tell those apart and neither can a timeout.
```

To see either failure directly, run the Playwright CLI from this directory:

```bash
VA_PORT=4319 VA_RESULTS=/tmp/announcement-results VARIANCE_AUTHORITY_EVENTS=1 \
  node ../../node_modules/@playwright/test/cli.js test \
  --config=src/playwright.config.mjs --grep=diagnosis
```

It exits 1. That is the point of it.

## Scope

This case runs on one Chromium, on one machine, over an HTTP server of a few
dozen lines. It covers the announcement and the wait, and nothing about image
comparison — no baseline is recorded here and no pixel is read. The package is
`"private": true` and has no scripts of its own; the Vitest file above is the
whole entry point.
