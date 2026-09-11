# Distil a test to the behavior it witnesses

`variance distill` reads one test from two independent observations: what the
test addressed, and what source the test entered. It reports the overlap and
names the residue as opportunities for a smaller test boundary.

```bash
npx variance distill \
  --test 'checkout submits' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

The command is deterministic. The same inputs produce the same ordering and
the same answer; it does not open a browser, run a test, or edit source.

## The three readings

Eyes records the selectors, locators and events a test consumed while their DOM
targets were live. Each target carries its React owner path and source location
when that attribution exists. The test supplies `arrange`, `act` and `assert`
markers; Eyes records those authored boundaries and never guesses a phase from
an API name.

React commits in the same journal keep update initiators separate from all
components whose render bodies ran. Distill places an initiator inside an
addressed component path only when their structural path frames overlap. An
initiator outside the addressed paths is an entanglement to investigate: code
the test did not address initiated work during the same authored phase. It is
not proof of the source statement that scheduled the update.

Sense supplies the files entered by the exact same test id and their nearest
observed depth. Its execution index is whole-test evidence, not AAA evidence,
so distill does not assign those files to a phase. An entered file with no Eyes
target attributed to that file is a **distillation opportunity**.

```text
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 2 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime journey: 4 source file(s) entered by exact test id.
Entered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 4 — src/analytics.ts
  distillation opportunity at depth 5 — src/top-nav.tsx
```

An opportunity is not permission to mock, replace, or delete the file. Static
reachability describes what the test could load; execution says what it entered;
attention says what it addressed. None says what the test would still witness
after a substitution.

## One capability, three entrances

| Entrance | Use it when | Invocation |
| --- | --- | --- |
| CLI | the evidence is in portable files | `variance distill --test <id> --eyes <path> --execution <path>` |
| MCP | a producer already supplies Eyes and Sense evidence to a connection | `variance_distill {"test":"<id>"}` |
| `variance-authority` skill | an agent must turn opportunities into a smaller verified test | install the skill shipped by `@variance-authority/cli` |

The CLI and MCP tool call the same analyzer and text formatter. `--format json`
exposes the analyzer result for another deterministic consumer. The skill adds
judgment; it does not replace the reading.

## The agent loop

For each opportunity, the agent identifies the narrowest reversible
substitution, changes one boundary, and reruns the exact test. It compares the
new attention and execution witness with the original before keeping the edit.
If an assertion loses its causal path, an addressed target disappears, or an
outside update initiator reaches the retained surface, the substitution is
reverted or the test is adjusted to state the behavior it actually owns.

This is where mocking becomes justified: by a counterfactual run, not by an
unused percentage. Distill supplies the ordered work list and the evidence to
compare; the agent verifies each proposed boundary.

## Tests without Fiber

Distill does not require React. A plain unit test or a test over a fake component
can supply only an execution index and still receive an entered-source reading.
Without Eyes, the entered-versus-addressed opportunity comparison is unavailable.
With a complete empty Eyes journal, the addressed surface is measured empty and
the comparison can proceed. Neither case is printed as zero Fiber usage.

The current reading counts addressed target paths and entered files. It does
not claim a percentage of the Fiber tree: unmounted, hidden, lazy and
never-observed branches have different denominators, and a DOM target does not
establish that every ancestor or descendant participates in the assertion.
