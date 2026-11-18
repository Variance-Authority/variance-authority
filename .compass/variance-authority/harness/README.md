# Harness

## Responsibility

Says where an action a test performed ended, among the outcomes the test
declared for it.

## Logical role

Every other block reads what a run left behind. This one is a piece of the
adopter's own harness, offered rather than required: the test declares that
submitting can reach the next page, open a dialog or stay, and performing the
action names the one the app reached. It is why a test that expected another
outcome fails naming the declared outcome the app reached, and why an outcome that is the absence
of a change is not reported before the app had its chance to make one.

## Boundary

It owns the declared outcomes of an action, nothing else. Locating an element
and waiting for it stay the [test host](../../externals/test-host.md)'s: an
outcome is recognised through the host's own locator. It exports no `test`, no
`expect`, no configuration and no lifecycle. It reads no signal the app was
written to give — no `aria-busy`, no announced event — records nothing, and
keeps nothing after the action returns. It does not say when an action may
start, and it models no page: what is on screen besides the declared outcomes
is not its question.

## Technology

TypeScript on Node. Playwright's `Page` and `Locator` as types only, with
`@playwright/test` as a peer; the page's own request events as the one sign of
pending work.

## Implementation coordinates

- `packages/page-broker/src/` — the action, its outcomes, and the watch on the
  page's requests
- `cases/page-broker-case/src/declared/` — the package over a shop that
  announces nothing and over Storybook's manager

## Communicates with

No block. It imports nothing from the rest of the chart and nothing imports it.

## Uses

### [Test host](../../externals/test-host.md)

#### Why

Whether a part of the page is visible is a question the host already answers,
with the adopter's own selectors. A second way to find an element would be a
second answer to disagree with.

#### What I need from it

A locator that can be asked once whether it is visible, without waiting, and
the page's request events.

#### What would make me leave

A host whose locators could only be awaited, never asked.
