# Explain variance

Something moved, and the report you are holding names a region but not a
reason. Which page helps depends on the kind of explanation that is missing: a
component name, the input that changed, a second reading that disagrees with
the first, or a declaration that the region was never the subject. Each row
below names one and the page that produces it.

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id like `story:checkout--empty`. Every question here is
asked about one.

## Ask what kind of explanation is missing

| Question | Route |
| --- | --- |
| Which component and source line own a changed region? | [Attribute the change](attribution.md) |
| Where did two readings of the same page start to differ? | [Find where they part](parting.md) |
| Did the subject disagree with itself, and who can remove the cause? | [Classify a flake](flakiness.md) |
| Could the page still have been moving when it was captured? | [Hold the page still](stabilization.md) |
| Did one edit change forty subjects that share a component? | [Compose repeated evidence](composition.md) |
| Is this subject a deliberate variant of another — a flag, a scheme, a breakpoint? | [Declare a variation](variations.md) |
| Which kinds of change should this subject assert on at all? | [Set sensitivity](sensitivity.md) |
| Which region is deliberately outside the decision — a clock, an embed? | [Declare an ignore](ignores.md) |

The rows are not steps and none is a prerequisite for another. A region already
attributed to a component needs no flake analysis, and a variation can explain a
difference without authorizing it.

## Ask the report from a shell

A completed run writes a report, and the CLI answers these questions from it
without an MCP client or a browser:

```bash
npx variance ask summary
npx variance ask changes --component Toggle
npx variance ask describe --subject story:checkout--empty
npx variance ask explain-verdict --subject story:checkout--empty
```

Start at `summary`: it accounts for the subjects that were planned and never
observed as well as the ones that produced a verdict, and every other question
takes an identifier it prints. `ask` reads and never decides — every answer
exits `0`, and the verdict stays with `run`, `report` and `adjudicate`.
[Asking from the command line](agent-cli.md) covers the full set of questions.

## What an explanation does not do

An explanation does not approve anything. Nothing accepts a baseline on your
behalf, so a cause you understand still goes to review as a change to accept or
reject.

Two verdicts are not code problems at all, and `explain-verdict` is there to say
so before you go looking for an edit: `new` means no baseline has been approved
for that subject yet, and `incomparable` means a baseline exists but another
browser, platform, scale factor or font stack rendered it. Where the evidence
for a hop is missing — no component name on an element, no second reading to
part against — the answer stops at the last hop it could complete and names the
one it could not.
