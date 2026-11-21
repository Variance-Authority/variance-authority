# Harness

## Responsibility

Says where an action a test performed ended, among the outcomes the test
declared for it.

## Logical role

Every other block reads what a run left behind. This one is a piece of the
adopter's own harness, offered rather than required: the test declares that
submitting can reach the next page, open a dialog or stay, and performing the
action names the one the app reached. It is why a test that expected another
outcome fails naming the declared outcome the app reached, why an outcome that is the absence
of a change is not reported before the app had its chance to make one, and why
an app that went somewhere no outcome declares fails the action.

## Boundary

It owns the declared outcomes of an action, nothing else. It exports no `test`,
no `expect`, no configuration and no lifecycle. It reads no signal the app was
written to give — no `aria-busy`, no announced event — records nothing, and
keeps nothing after the action returns. It does not say when an action may
start, and it models no page: what is on screen besides the declared outcomes
is not its question.

One model decides every outcome; a surface only finds, looks, acts and says
what counts as pending and as elsewhere. Over a browser, finding and visibility
are Playwright's. Over a document, finding is Testing Library's and visibility
is decided here, from `hidden` and computed style, since a document has no
layout; `fetch`, `XMLHttpRequest` and `window.open` are wrapped while an action
runs and put back by the last overlapping action to finish.

## Technology

TypeScript on Node, behind two entries with optional peers: `playwright-core`
for a browser page, and `@testing-library/dom` with
`@testing-library/user-event` for a document in jsdom, happy-dom or a runner's
browser mode. Over a browser the page's request events are the sign of pending
work and its navigation and popup events the sign of having left; over a
document, requests in flight and changes to it are pending, and a location
change, `window.open` or a new modal dialog is having left.

## Implementation coordinates

- `packages/page-broker/src/` — the action and its outcomes, the quiet told
  from the page's requests, and the watch for a destination not declared
- `cases/page-broker-case/src/declared/` — the package over a shop that
  announces nothing and over Storybook's manager

## Communicates with

[Arrival](../stability/arrival/README.md): over a browser, which requests
count as work is `awaitedRequest` from `@variance-authority/core`, the list
arrival waits on, so the two never disagree. Nothing imports this block.

## Uses

### [Test host](../../externals/test-host.md)

#### Why

Finding a part of the page is a question the host already answers, with the
queries the adopter already writes. A second way to find an element would be a
second answer to disagree with.

#### What I need from it

Over a browser, a locator that can be asked once whether it is visible, without
waiting, and the page's request, navigation and popup events. Over a document,
the queries and user events of Testing Library, which the adopter's tests
already use.

#### What would make me leave

A host whose locators could only be awaited, never asked.
