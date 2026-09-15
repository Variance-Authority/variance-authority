# Agent claim

**Showcase:** the agent boundary — a run read back against what the agent said
it was doing, not ordinary visual regression.

An agent that edits a design system and then looks at a diff can only learn what
moved. The thing it most needs to know is the opposite: that `Card`, which it
believes it just edited, did not move at all. That is not a diff finding, it is
the absence of one, and an absence only becomes a finding once something
declared it should have been there.

So this example declares first. [`claims.json`](claims.json) is written before
anything reads a diff, and the run is adjudicated against it. Four claims are
enough to produce every outcome the boundary has:

| Claim | Outcome | Why |
| --- | --- | --- |
| `component:Button`, at most 1 subject | `overreached` | It changed, and reached two subjects |
| `component:Badge` | `delivered` | It changed, within an undeclared bound |
| `component:Card` | `undelivered` | It rendered in two subjects and held still |
| `component:Tooltip` | `unobservable` | This run never rendered it, so nothing here is evidence |
| `Avatar` — undeclared | `unclaimed` | It moved, and no claim covers it |

`Button` is the pair worth reading together: an agent that over-claims to avoid
the `unclaimed` line walks into `overreached`, and an agent that under-claims to
avoid `overreached` collects `unclaimed` changes. Both directions cost something,
which is what makes the declaration worth trusting.

The run is **ephemeral**: the
collector renders both revisions in one process, hands the CLI a `before`
document alongside the `after`, and keeps neither. Nothing was recorded on a
previous machine, so nothing about the machine has to cancel out — which is what
makes this shape the right one for a run performed to answer a question rather
than to defend a baseline. [`src/system.js`](src/system.js) holds both palettes
for exactly that reason.

Provenance is `data-component` on plain DOM. No framework is involved, and the
report still names components, attributes diff regions to them, builds the
composition census that separates *rendered and held still* from *never
rendered*, and prints `examples/agent-claim/src/system.js:28`.

**What it proves:** the three arms are reachable at the surfaces an agent has.
`variance adjudicate` and the `variance_adjudicate` MCP tool answer the same run
with the same sentences, over a CLI flag and over stdio JSON-RPC. Both refuse to
derive a claim: the MCP call in the demo declares two of the four, and the two it
drops come back as `unclaimed` rather than quietly passing. It also carries one
field this resolution cannot check — a `bands` claim, which no run report keeps
per change — and the answer says `Not checked here: bands` instead of reporting
`delivered` about something nothing looked at.

**Boundary:** three fixtures and four components in Chromium, with claims chosen
to land one on each verdict. It proves the boundary's shape and its refusals, not
that root matching resolves an arbitrary application's component names.

Run it with:

```bash
yarn workspace @variance-authority/example-agent-claim demo
```

It prints three steps. `variance run` observing the branch and `variance
adjudicate` reading it back against the declaration, each with its exit code
decoded, and then the same question over MCP — `initialize`, `tools/list`, one
`tools/call`. It asserts nothing. The audience is whoever — or whatever — reads
the output and decides what to edit next.

What decides is a second script, kept separate because a file that both
narrates and asserts does neither well:

```bash
yarn workspace @variance-authority/example-agent-claim verify
```

It checks the claims this page makes, against the shipped binaries, and exits
non-zero when one stops holding. The interesting ones are the transport claims a
pure unit test cannot reach — a JSON-RPC frame split where the OS split it, a
notification that must produce no reply at all, a report rewritten under an open
session — and the one that matters most for two surfaces: **the CLI and the MCP
tool, given the same claims, answer with the same text.** Two renderings of one
adjudication is how they drift.

It is this repository's client talking to this repository's server, so it proves
the transport works rather than that it matches somebody else's reading of the
spec — the same trade [`packages/mcp/src/protocol.ts`](../../packages/mcp/src/protocol.ts)
takes for the server half.
