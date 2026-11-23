# Conditional orientation experiments

Use this repository-only runner to test an explicit sequence of existing source
questions without an agent choosing between calls. It is research tooling for
[#1743](https://github.com/Variance-Authority/variance-authority/issues/1743),
not a learned policy or a shipped `ask` command. A completed program does not
establish that its files solve the coding task.

From an installed, built repository, run the self-tests:

```sh
node --test tools/orientation-runbook/*.test.mjs
```

These tests run explicitly, outside the product Vitest slices. The integration
fixture publishes its own index, follows component → example → mock relations,
and runs a fresh reader after deleting the live fixture source. No external
checkout is indexed by these tests.

To run your own program against an already published index:

```sh
node tools/orientation-runbook/run.mjs /path/to/checkout program.yaml request.yaml /path/outside/checkout/new-receipt.yaml built-tree-id
```

The final argument is your declaration of the build used; the runner does not
verify it. The receipt records it, the published generation, source-index path,
and hashes of the program and request. Questions never refresh the index or
compare it with live files. The receipt must be new and outside the queried
checkout; it includes full answers and file membership, so keep private inputs
and receipts private.

[`example.yaml`](example.yaml) starts with declarations matching the request's
`name` regular expression. Supply a request such as:

```yaml
name: ^Panel$
query: panel
```

Steps run in listed order. `input` uses the tool schema's property names and
types, not CLI flags. `request` binds input properties from request keys.
`fromFiles` dispatches once per distinct file observed by an earlier step,
binding an array of one path. A `when`
condition tests an earlier step's aggregate `empty`, `nonempty`, `incomplete`,
`unknown`, or `error` state. The example's fallback is retrieval only; graph
expansion uses the declaration seed. It is an illustrative policy, not an
evaluated recommendation.

Eligible questions are derived from registered source tools exposing full
`Tool.files` membership. Composite tools without that capability are excluded.
Bound inputs are validated against the tool's own schema. Repeated identical
calls reuse evidence; incomplete parent bindings remain incomplete even if each
observed child answered completely. The trace distinguishes skipped steps,
reader errors, membership uncertainty and budget stops.

`calls` limits question dispatches. Each can invoke `Tool.files` and `Tool.run`;
the trace counts those APIs separately, without claiming to count native reader
executions. `milliseconds` is one soft invocation deadline, including index
opening; an in-flight reader cannot be cancelled. `answerBytes` limits only
canonical answer text in the stdout summary. Metadata and the full evidence
receipt are not byte-limited. A whole answer exceeding the remaining allowance
is omitted from that summary and ends execution with `answer-budget`; its full
text remains in the receipt. Pending steps and bindings are counted explicitly.
