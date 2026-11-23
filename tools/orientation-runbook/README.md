# Conditional source-question experiments

Use this repository-only runner when an experiment needs one source question's
files to become the inputs of another question. A YAML program chooses the
branches in advance; no agent chooses between calls. It supports the research
in [#1743](https://github.com/Variance-Authority/variance-authority/issues/1743).
Program completion does not establish that its files solve a coding task.

Run the checks, which CI runs through the repository rules wave:

```sh
yarn check tools/orientation-runbook/execute.check.ts tools/orientation-runbook/questions.check.ts
```

The fixture publishes its own index, follows component → example → mock
relations, and compares answers with the CLI. These checks are separate from
the product's case-level selection recording.

From an installed, built repository, query an already published index:

```sh
node tools/orientation-runbook/run.mjs /path/to/checkout program.yaml request.yaml /path/outside/checkout/new-receipt.yaml
```

The receipt must be new and outside the queried checkout. It records the
published generation, source-index location, input hashes, configured budgets,
full answers, membership and costs. Record the runtime build separately with
your experiment inputs. Keep private inputs and receipts private.

The runner never refreshes the index. Indexed declarations and relations read
that generation; `grep` and `discover --text` also read live checkout contents.
Their results can change without republishing the index. The receipt states
this limitation and preserves returned evidence; it does not capture every
source file read or make live text queries independently reproducible.

[`example.yaml`](example.yaml) starts with declarations matching the request's
`name` regular expression. Supply a request such as:

```yaml
name: ^Panel$
query: panel
```

Steps run in listed order. `input` uses tool property names and types, not CLI
flags. `request` binds input properties from request keys. `fromFiles`
dispatches once per distinct observed file, binding an array of one path.
For a scalar input such as `uses.file`, write
`fromFiles: { step: declarations, input: file, as: string }` to bind the path
as a string instead. Supply the name separately through `input` or `request`;
the binding selects neither a name nor a relevant declaration.
Bindings follow observed set order, which is not relevance order. Receipts
retain the parent candidates, calls made and omitted-binding count when a
budget stops a fan-out.

A `when` condition checks an earlier step's aggregate `empty`, `nonempty`,
`incomplete`, `unknown`, or `error` state. A condition-skipped step has its own
state and triggers none of those conditions. A follow-up over a complete empty
set is empty; incomplete parents remain incomplete. A not-found textual answer
does not prove complete membership: follow its membership qualification.

Eligible questions come from registered source tools. `Tool.run` supplies the
factual answer; optional `Tool.files` supplies membership. Without it, membership
is unknown: an `unknown` branch can continue, but `fromFiles` has no files to
dispatch. Each tool owns its input refusal. Repeated identical calls reuse
evidence. Unexpected reader failures
preserve earlier evidence and take the error branch; unavailable API counts
are unknown.

`calls` limits question dispatches. Each invokes `Tool.run` and, when supplied,
`Tool.files`; API counts include only attempts, not underlying native executions.
`milliseconds` is a soft
execution deadline including index opening; an in-flight reader cannot be
cancelled. Reuse also stays within that invocation deadline.

`answerBytes` limits canonical answer text in the stdout summary. An answer
that does not fit is omitted whole; execution continues, and later smaller
answers can still fit. Metadata and the full evidence receipt are not
byte-limited. The illustrative program is a supplied policy, not an evaluated
recommendation or an automatic policy selector.

The stdout `candidateCatalog` separately lists exact observed paths and their
receipt evidence indices, including paths from omitted answers. It preserves
per-observation membership states, unread notes and errors; it ranks nothing.
Match lines, inputs, bindings and source detail remain in the receipt.
Its standalone YAML `payload` has a second allowance equal to `answerBytes`;
`payloadBytes` counts that encoding, without stdout's surrounding indentation.
These two allowances do not bound total stdout. Paths are omitted whole when
they do not fit; later smaller rows can fit. If observation metadata alone
exceeds the allowance, no payload is displayed. `omittedFiles` and
`omittedObservations` disclose both cases. An empty catalog is no claim of
empty source membership or task completion.
