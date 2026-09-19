# Agent claim

You edit a design system and you want to know whether the edit did what you said
it would. A list of what changed cannot tell you that `Card`, which you believe
you just edited, did not change at all — an absence only becomes a finding once
something declared it should have been there. This example declares the intent
first, runs the change, and reads the run back against that declaration: each
component you named gets a verdict, and anything that changed without being named
is called out on its own line.

Two words this page uses throughout:

- A **subject** is one named UI state you asked for and can ask for again, under
  an id you choose. This example has three: `card/summary`, `card/compact` and
  `badge/standalone`.
- A **claim** is what you declare before the run: a root (`component:Button`), a
  reason in your own words, and optionally a cap on how many subjects the change
  may reach.

## What the example declares

[`claims.json`](claims.json) is written before anything reads a diff, and the
run is adjudicated against it. Each claim is a root, a reason, and an optional
bound:

```json
{
  "claims": [
    { "root": "component:Button", "reason": "new brand accent on the primary action", "maxSubjects": 1 },
    { "root": "component:Badge", "reason": "new brand accent on the status pill" },
    { "root": "component:Card", "reason": "tighten the gap between the avatar and the action" },
    { "root": "component:Tooltip", "reason": "arrow follows the new accent" }
  ]
}
```

`reason` is required and never matched on — it is carried into the answer, which
is read by whoever picks the branch up next. A bare array of claims is accepted
too; an empty one is refused rather than adjudicated.

Four claims are enough to produce all four claim verdicts, and one undeclared
change produces the fifth line an adjudication can print:

| Claim | Outcome | Why |
| --- | --- | --- |
| `component:Button`, at most 1 subject | `overreached` | It changed, and reached two subjects |
| `component:Badge` | `delivered` | It changed, within an undeclared bound |
| `component:Card` | `undelivered` | It rendered in two subjects and held still |
| `component:Tooltip` | `unobservable` | This run never rendered it, so nothing here is evidence |
| `Avatar` — undeclared | `unclaimed` | It changed, and no claim covers it |

`Button` is the pair worth reading together: an agent that over-claims to avoid
the `unclaimed` line walks into `overreached`, and an agent that under-claims to
avoid `overreached` collects `unclaimed` changes. Both directions cost something,
which is what makes the declaration worth trusting.

The run is **ephemeral**: the collector in
[`collector/index.mjs`](collector/index.mjs) renders both revisions in one
process, hands the CLI a `before` document alongside the `after`, and keeps
neither. Nothing was recorded on a previous machine, so nothing about the machine
has to cancel out — which is what makes this shape the right one for a run
performed to answer a question rather than to defend a baseline.
[`src/system.js`](src/system.js) holds both palettes for exactly that reason, and
[`page/harness.html`](page/harness.html) with
[`src/page-agent.js`](src/page-agent.js) is what the browser loads.

Provenance is `data-component` on plain DOM. No framework is involved, and the
report still names components, attributes diff regions to them, builds the
composition census that separates *rendered and held still* from *never
rendered*, and prints `examples/agent-claim/src/system.js:28`.

## Run it

Prerequisites: a checkout, `yarn install`, `yarn build` at the repository root
(the scripts invoke the CLI from `packages/cli/dist/bin.js`), and a Chromium for
Playwright — `npx playwright install chromium`.

From the repository root:

```bash
yarn workspace @variance-authority/example-agent-claim demo
```

`scripts/demo.mjs` prints three steps: `variance run` observing the branch,
`variance adjudicate` reading it back against the declaration, and then the same
question over MCP — `initialize`, `tools/list`, one `tools/call`. Each shell step
decodes its own exit code: `0` nothing needs review, `1` the run happened and
found something a person must decide about, `2` the run did not happen as
configured. A verdict and a crash never share a code, so a caller can branch on
`2` to page whoever owns the runner image and on `1` to ask a reviewer.

The demo asserts nothing. The audience is whoever — or whatever — reads the
output and decides what to edit next. Abridged, the second step prints:

```
$ variance adjudicate --config variance.config.json --claims claims.json

An edit you declared did not take. Fix that before reading anything else.
4 claim(s): 1 delivered, 1 undelivered, 1 over-reaching, 1 unchecked. 1 unclaimed change(s).

  [undelivered] component:Card
      declared (tighten the gap between the avatar and the action) and `Card` rendered in 2 subject(s) — card/summary, card/compact — and did not change. The edit did not take: wrong file, a dead branch, a rule something else overrides, or a stale build.

  [unobservable] component:Tooltip
      declared (arrow follows the new accent) and this run never rendered `Tooltip` in any subject, so nothing here is evidence about it either way. Check the subject selection, or whether provenance names this component.

  [overreached] component:Button
      declared (new brand accent on the primary action) and delivered, but reached 2 subject(s) against the 1 declared — the change is the intended one, its reach is not.
      examples/agent-claim/src/system.js:28

  [delivered] component:Badge
      declared (new brand accent on the status pill) and delivered: component:Badge changed in 1 subject(s): badge/standalone.
      examples/agent-claim/src/system.js:38

  [unclaimed] Avatar
      Avatar moved and no claim covers it — 1 subject(s), 577 pixel(s), nothing it can settle on its own
      examples/agent-claim/src/system.js:48

[exit 1: changes need review]
```

Every outcome in the table above is reachable from both surfaces an agent has.
`variance adjudicate` and the `variance_adjudicate` MCP tool answer the same run
with the same sentences, over a CLI flag and over stdio JSON-RPC. Neither derives
a claim: the MCP call in the demo declares two of the four, and the two it drops
come back as `unclaimed` rather than quietly passing. That call also carries one
field this resolution cannot check — a `bands` claim, which no run report keeps
per change — and the answer says `Not checked here: bands` instead of reporting
`delivered` about something nothing looked at.

The scope is three fixtures and four components in Chromium, with claims chosen
to land one on each verdict. It shows the shape of the boundary and its refusals,
not that root matching resolves an arbitrary application's component names.

## What checks it

A second script, kept separate because a file that both narrates and asserts does
neither well. From the repository root:

```bash
yarn workspace @variance-authority/example-agent-claim verify
```

`scripts/verify.mjs` checks the claims this page makes against the shipped
binaries, and exits non-zero when one stops holding:

```
  ok   the CLI and the MCP tool answer the same claims identically
  ok   adjudicate exits 1 when a run needs review
  ok   a request split across two writes is still answered
  ok   a notification is not answered
  ok   an unknown tool is a transport error
  ok   an unknown subject is a readable result, not a transport error
  ok   a report rewritten mid-session changes the next answer

7/7 claims hold.
```

The interesting ones are the transport claims a pure unit test cannot reach — a
JSON-RPC frame split where the OS split it, a notification that must produce no
reply at all, a report rewritten under an open session — and the one that matters
most for two surfaces: **the CLI and the MCP tool, given the same claims, answer
with the same text.** Two renderings of one adjudication is how they drift.

It is this repository's client talking to this repository's server, so it shows
the transport works rather than that it matches somebody else's reading of the
spec — the same trade the server half takes.
