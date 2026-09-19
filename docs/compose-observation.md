# Compose an observation

Wiring an observation into a suite you already have is four separate decisions:
which of your harnesses sets up the state, what gets captured and where the
pixels are painted, where the answer is consumed and how long it is kept, and
who holds the baseline between runs. This page is the index to those four. If
you have not run anything yet, [your first run](start.md) takes one UI state
through capture, review and acceptance end to end.

## The four decisions

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id such as `story:checkout--empty`. Each row below is one
decision about how subjects get observed, and the page that makes it.

| Decision | What it changes | Where it is made |
| --- | --- | --- |
| Which harness sets up the state and declares it ready | Lifecycle, subject discovery, the ids your baselines are named by | [Choose from the state you already have](cases.md) |
| What is captured, and where pixels are painted | Portability, what leaves your network, which evidence travels, latency, renderer identity | [Connect your suite](surface.md) |
| Where the answer is consumed and how long it is kept | Infrastructure you operate, where review happens, how far back you can ask | [Choose an operating flow](flows.md) |
| Who holds the baseline between runs | Baseline lookup, acceptance, storage cost | [Where baselines live](placement.md) |

The four are independent, and answering one does not answer another. A Storybook
host does not require local rendering, and a Playwright host does not require
pixels taken in place. Where baselines are stored does not change the verdict a
run reports — `unchanged`, `changed`, `new` or `incomparable`; what decides
whether two captures may be compared at all is the renderer that painted them.

## Start from the harness that already sets up the state

Pick the first decision by asking which of your existing harnesses already
navigates, logs in, seeds fixtures and decides the UI is ready. Navigation,
fixtures, authentication and readiness stay there. Then take the smallest answer
to the other three that still answers your question.

Every combination produces the same comparison and the same report. What differs
between them is what each one was able to see.

## What you capture decides what the report can say

Component [attribution](attribution.md) — the chain from a changed region to the
component that drew it and the `file:line` it was written at — browser
accessibility results, real geometry, and pixels painted in place by your own
test are each available only from some captures, and [Connect your
suite](surface.md) says which.

What a capture could not see is never reported as `unchanged`. Both sides of a
comparison must share one **observation profile** — what the capture was able to
see at all, independent of what it found. `jsdom` resolves roles, accessible
names and author-declared style but has no layout engine; `chromium` adds the
resolved cascade, real geometry and pixels.

Add another host, renderer, store or consumer only when a decision you have
already made cannot be served without it.
