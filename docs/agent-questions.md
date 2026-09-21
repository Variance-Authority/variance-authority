# Everything an agent can ask

Start from what you kept — a finished report, a watcher still attached to the
suite, an [Eyes](eyes.md) archive, or a checkout alone — and take the entrance
you have:

- the CLI reads files and live watchers from a shell;
- MCP exposes the same readings when a producer already owns a connection;
- the `variance-authority` skill chooses the next question and, for test
  reduction, runs the counterfactual verification loop;
- the `variance-workspace-api` skill routes the source-reading questions, which
  need no run and no evidence at all.

A missing domain is unavailable, never an empty measurement.

## Route from the evidence

| Evidence in hand | First question | CLI | MCP |
| --- | --- | --- | --- |
| completed visual report | What changed? | `variance ask summary` | `variance_summary` |
| live watcher | Is this the watcher the suite connected to? | `variance ask self` | `variance_self` |
| [Eyes](eyes.md) archive and/or [execution index](execution-record.md) | What can this test be distilled to? | `variance distill --test <id> …` | `variance_distill` |
| current workspace source | What does this package publish? | `variance ask packages` | `docs_packages` on the workspace API server |
| current workspace source | Where is this symbol already used, and what shows how to call it? | `variance ask uses --name <name>` | `docs_uses` on the workspace API server |
| current workspace source | What is the name for the thing I can only describe, in the part of the repository I am working in? | `variance ask search --query <word> --from <path>` | `docs_search` on the workspace API server |

`variance ask` with no question lists every report, watcher and source question
and its arguments. The source questions read the checkout under the working
directory and need no `variance.config.json`; the same six are on the
`variance-authority-help` binary for a workspace that installs nothing else. `variance_observability` inventories the domains supplied to a
combined MCP connection before an agent asks from one of them. For every
unavailable domain it also names the producer and integration guide.

## Supply a missing reading

Each reading comes from the instrument that owns the fact. MCP does not install
that instrument or reconstruct its output:

| Missing reading | Producer route | Required boundary |
| --- | --- | --- |
| visual report | `variance run` with a configured report path; see [run an existing collector](start-cli.md) | supply the resulting `RunReport`, not configuration interpreted after the run |
| full presentation graph | `sensePresentation` from `@variance-authority/presentation/playwright`; see [presentation](presentation.md) | acquire the live subject once and supply its `PresentationReport` |
| per-test source execution | a Vitest run wrapped with `cases: true`, or any runner, debugger, or editor integration that owns per-test crossings; see [Sense](../packages/sense/README.md#record-which-case-covered-a-region) | supply stable test ids in an `ExecutionIndex`; the per-file test-selection snapshot cannot substitute |
| live events | compose `varianceFixtures`, then follow [inspect a live run](agent-live-run.md) | start the watcher before the suite and use the exact address it prints |
| Eyes attention | compose the RTL or Playwright adapter using the [Eyes integration reference](../packages/eyes/README.md) | author AAA markers, retain journals with their completion state under stable runner ids, and install React observation before `react-dom` loads |
| scenario AAA | record host-produced snapshots and Acts using the [scenario reference](../packages/scenario/README.md) | archive the semantic executions when they must survive the process |

A durable presentation signal inside a run report and a full presentation graph
are separate readings. Supplying one does not make the other available.

## Review a completed visual run

A run report is immutable evidence. Asking it does not open a page, take a
screenshot or rerun a test. Follow the dependency between answers:

1. `summary` counts verdicts and names subjects that need attention or were not
   observed. Unobserved is not unchanged.
2. `changes` groups subjects under the distinct changes behind them. A token
   edit reaching many stories remains one decision.
3. `adjudicate --claims <path>` compares an edit with intent declared before
   the diff was read. Skip it when reviewing somebody else's run.
4. `composition` explains a change and separates a subject read twice that
   differed from one never read twice. `variations` compares intentional peers.
5. [`locate --query <words>`](locate.md) finds the subject when the agent has a
   description rather than an id. It searches every name the run wrote down —
   component, role, accessible name, visible text, file, region, token — and
   prints the field each hit matched on, so a wrong first hit is visible rather
   than inferred.
6. `describe`, `explain-verdict`, `trace-component` and `findings` narrow to one
   subject or component.
7. `changelog` previews what acceptance would record. It is the last reading
   before proposing an accept.

The shell form is `variance ask <question>`; the MCP form prefixes the question
with `variance_`. Both call the same tool functions. `diff` compares the current
reading with the preceding successful one.

## Inspect a suite in flight

A suite in flight has no completed artifact. Its lifecycle and application
announcements go to `variance watch` or `variance-authority-mcp --watch`.
`self`, `run-signals`, `test-signals` and `diff` are available through both
entrances. The connection, address model and lifetime boundary are in
[inspect a live run](agent-live-run.md).

`variance_waiting` and `variance_continue` are MCP-only, and answer about a test
that has stopped at a call its author wrote rather than about the run as a
whole: where it stopped, what it sent from there, and when it may go on. The
worked spec and tool sequence are in [interrogate a test where it
stands](agent-interrogate.md).

Live signals do not report authored AAA attention. They answer where progress
stopped, not what UI the test owns.

## Distill one test

AAA is authored structure, not an inference:

- **Arrange** establishes the state the test deliberately needs;
- **Act** performs the user or system operation under test;
- **Assert** reads the consequence that makes the test valuable.

Eyes records explicit phase markers alongside queries, consumed Playwright
locators, DOM events and React commits. [Sense](../packages/sense) records source covered by the
whole test. `variance distill` combines them by exact producer test id, reports
addressed targets per authored phase, separates React update initiators inside
and outside addressed paths, and lists covered files without addressed source
[attribution](attribution.md) as opportunities.

The deterministic command and `variance_distill` MCP tool return the same
reading. The skill then tries one reversible substitution, reruns the exact
test, and compares the witness before keeping an edit. This division matters:
the analyzer can nominate a file; only the counterfactual run can justify the
new boundary. See [distill a test to the behavior it witnesses](distill.md).

A plain unit test, fake component or non-React harness remains eligible. With
execution evidence it receives a source reading. Without Eyes, attention and
the opportunity comparison are unavailable; a complete empty Eyes journal
licenses the comparison. No Fiber percentage is invented.

## Read each evidence type literally

- `PerformedWork` names render bodies that ran; it does not name the initiator.
- React `memoizedUpdaters` identifies live component instances whose queues
  initiated a commit; it does not identify the source statement that called a
  setter.
- A covered file without an addressed target is a distillation opportunity,
  not a safe mock.
- An authored phase marker classifies later observations until the next marker.
  Execution indexes remain whole-test evidence.
- Stable test ids are the only cross-domain join. Titles and files are not
  guessed when identities disagree.

## Boundaries

Questions read; they do not run tests, mutate pages, approve baselines or edit
files. The skill may perform those actions only when the user has asked for a
test-changing workflow. A report remains canonical for the visual run, the
watcher for live signals, Eyes for attention, Sense for execution, and the
workspace for its published source API.
