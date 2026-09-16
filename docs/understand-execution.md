# Understand an execution

[Variance Authority](README.md) renders and compares your **subjects** —
stories, routes, fixtures or values — and an assertion records only the answer
to a question chosen before the run. An execution contains more: what it
addressed, where it travelled, what updated, what spoke, and what opened
without closing, whatever framework produced it. Where a signal names a
rendering component, that attribution comes from React, and only when React
mounted the element. Keeping those signals gives you something concrete to
inspect when the interesting question arrives during or after the run.

## Choose by evidence lifetime

| Question | Evidence | Route |
| --- | --- | --- |
| What is a running suite doing now? | Process-local lifecycle, announcements, and unfinished work | [Watch from a vantage](vantage.md) |
| What did the page know before teardown? | Retained runtime observations gathered while it was alive | [Ask beyond the assertion](observability.md) |
| Which elements did the test address? | Authored interactions joined to React ownership, when React rendered them, and source | [Follow its eyes](eyes.md) |
| Which source regions did one execution enter? | A [journey](journeys.md) across every instrumented process it touched | [Read the journey](journeys.md) |
| Where did two stateful executions part? | Witnessed Acts, state, and structural digests | [Compare scenarios](scenarios.md) |
| What can the test lose without losing its behaviour? | Attention and execution evidence followed by one counterfactual rerun | [Distill the test](distill.md) |

A live signal, a retained record, an attention map, a journey, and a scenario
are separate evidence lifetimes. Choose the one the question can still reach.

## Combine only on carried identity

The readings become more useful when they meet: an addressed element can name
the component that produced it, when React rendered it; a journey can connect one browser action to a
service branch; an update outside the addressed path can identify residue worth
testing.

Those joins use identities the producers carried across the boundary. Similar
titles, timestamps, and display names are orientation for a person, not proof
that two records describe the same execution.

## Where execution evidence stops

Execution evidence explains what the run did and what it observed. It does not
change the suite's assertions, approve a baseline, or infer that silence means
nothing happened. A live vantage disappears with its watcher; a retained
record says only what its installed instruments could see.

When the required evidence no longer exists, step back to a narrower question
or instrument the next run. Do not turn an absent observation into an empty one.
