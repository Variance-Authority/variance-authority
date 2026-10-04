# Extend what you already use

You already have tools built around how your software works. Your test runner runs
the suite. Playwright drives a browser. React Testing Library helps tests address
the interface. Your visual regression service compares screenshots and records
approvals. Your debugger, editor, search tools and documentation service answer
other questions. Replacing any one of them is a separate decision.

[Variance Authority](README.md) can work beside them. It reads source
relationships, records which code an execution ran, observes an interface, and
relates those readings when they describe the same change. You choose the
reading you need. The tool that creates a state, runs a test, or owns an
approval can keep that job. The [CLI and MCP](agent-workflows.md) also let an
agent ask about those readings without changing the interfaces people use.

## Keep the owner of the job

| Your existing job | Keep using | What Variance can add |
| --- | --- | --- |
| Get an application into a state | Your app, Storybook, Playwright, or a unit test | An observation of that state, made before the host tears it down |
| Address and assert on behaviour | React Testing Library or Playwright assertions | The elements the test addressed, the components that rendered them, and what else ran |
| Run tests | Vitest, Jest, Rstest, Playwright, or your own runner | A recorded relation between tests and source, then a skip list for a change |
| Compare screenshots | `toHaveScreenshot`, Percy, Chromatic, Argos, or another service | Selection of recorded test files, or an additional rendered observation when you ask for one |
| Inspect a running failure | Your debugger and test runner | Announced work and the test waiting for it, while the run is still live |
| Find code and explanations | Your editor, text or semantic search, and documentation service | Declared symbols, import relations, and observed subjects connected to source |

Those additions have different prerequisites. A source question needs a readable
checkout. Test selection needs an [execution record](execution-record.md).
Reading a rendered state needs a host that can produce it. The table is a set of
choices, not a setup sequence.

## Rendering stays with the host

A Storybook story, a Playwright test, a unit test and an application route create
states in different ways. Each host already holds the fixtures, navigation,
decorators, mocks and readiness conditions that make its state meaningful.
Variance does not need a preferred way to produce it.

When you ask for a rendered observation, the host still creates the state.
Variance reads it while it exists, then can compare its document, accessibility,
layout and pixels with another reading where those forms of evidence are
available. A browserless unit test can supply a document for a later browser to
paint; a Playwright test can use the browser it already opened. Those choices
change what evidence survives and what a second process has to reproduce. [Choose
from the state you already have](cases.md) describes each route and its cost.

This separation lets you add an observation to one state without asking
Variance to own the application's lifecycle. It also means there is no
observation unless a collector or test calls for one. The fact that a page
rendered somewhere is not, by itself, a Variance record.

## An assertion keeps its promise

A test that calls `getByRole('button', { name: 'Save' })` and checks what happens
after a click protects the behaviour its author chose. A passing assertion
does not show which other components rendered, which source ran without being
asserted on, or what the rest of the interface looked like. Making the assertion
broader would give it a different job.

[Eyes](eyes.md) can record which elements the test addressed and which React
components rendered them. The execution record can show which source the test
ran. Those are observations beside the assertion, not replacements for it.
React Testing Library still supplies the query, and Vitest or Jest still reports
whether the assertion passed. If the observations expose an unrelated branch,
you can investigate it without changing what the original test promises.

The same boundary applies in Playwright. Its `test`, `expect`, page, fixtures,
navigation and retries remain Playwright's. Variance's [Playwright
integration](../packages/playwright-test) adds an observation at a point the
test author chooses. A suite can keep every screenshot and semantic assertion
it already has.

## A visual regression service can keep the images

Visual regression is one use of these readings. If your current service already
compares screenshots and gives reviewers the approval process they need, keep
it. Variance can still help with the work around those screenshots.

For a screenshot suite whose test execution is recorded, [`variance
select`](run-relevant-work.md#start-with-the-saving-you-need) returns test files
that the runner may skip after a source change. A file containing screenshot
assertions is still a test file. The runner decides whether to use the skip
list; the screenshot service still compares and reviews whatever the runner
executes. This can avoid starting tests that did not run the changed source in
the recording, under [selection's stated boundaries](selecting.md).

The boundary matters. `variance run --since` selects Variance subjects using
the components recorded beside their Variance baselines. It does not select
Percy, Chromatic or Argos subjects or send them a plan. Test-file selection can
reduce a visual suite run through its runner; direct selection of another
service's inventory would need an integration that owns that connection.

You can also decide that one comparison belongs in Variance. [The Playwright
path](replacing.md#alongside-expectpagetohavescreenshot) can observe a locator
beside `toHaveScreenshot`, report semantic and structural changes, and name the
component behind a changed region. That observation has its own baseline and
review decision. Adding it does not require removing the existing assertion.

## A debugger keeps the process; a watcher keeps its reports

When a test stops in a debugger, you can inspect that process at that point.
When a test hangs in CI or finishes before you attach, the live process may be
gone before you ask what it was waiting for.

[Vantage](vantage.md) lets a suite report while it runs. It can show the test
that is waiting and the work application code announced, including work in a
service the test called. It reports only what the suite and application
instrumented; silence cannot prove that nothing happened. You can keep using
your debugger to step through code and use the live report to decide where to
look. Neither tool needs to impersonate the other.

## Search and documentation keep their own answers

If you know a name or an exact string, your editor or `rg` may be the shortest
way to find it. A documentation service can retrieve an explanation someone
wrote about the system. Those answers are useful on their own; Variance does
not improve them by routing every question through another search box.

Some questions ask for a relationship rather than a matching word. Which
module declares this symbol? What imports it? Which captured interface states
rendered this component? [Source orientation](orientation.md) reads declared
names and import relationships from the [source index](source-index.md), and
subject orientation adds evidence from completed runs. It can give you an
address to inspect without claiming that the code at that address is correct.

The documentation service still owns the explanations your team wrote.
Variance's source and execution readings answer what this checkout declares
and what a recorded run did. They do not supply the intent an author wrote into
a design document, and they do not verify that document for you.

## Give an agent a way to ask

Many of these tools have excellent interfaces for a person: a screenshot review
page, test output, a paused debugger, search results. An agent can use those
interfaces when they are available, but a passing test or a changed image alone
does not identify the source and components involved. A debugger session also
ends with its process. The relationships worth asking about later have to be
recorded while the tool is doing its job.

Variance exposes those recorded relationships through the CLI and MCP. From a
checkout, an agent can ask which package publishes a symbol and where it is
used. From a completed run, it can ask what changed and which source produced a
changed region. From a live watcher, it can ask what a test is waiting for. The
[agent workflows](agent-workflows.md) route each question to the evidence it
needs, so the agent can choose a next check without asking the runner, visual
service or debugger to become a different product.

The answer stays bounded by the evidence supplied. An MCP question does not run
a test, capture a new image or approve a baseline. A missing observation remains
missing. The agent can use the answer to investigate or propose a change, then
verify that change through the tools that already own the run and review.

## Add the reading the question needs

You can use source orientation without running tests. You can record execution
to select tests without capturing a screenshot. You can watch one live test
without keeping a visual baseline. You can observe one rendered state without
moving the suite's other assertions or approvals.

Sharing names across these readings makes further questions possible: a source
edit can be related to a test that ran it, a rendered component, and a changed
region. Each relation still depends on evidence that was actually collected.
When a reading is unavailable, Variance leaves that answer unavailable rather
than inventing one from the tools beside it. [Why Variance Authority does so
many things](adjacent-possible.md) explains why these separate uses belong in
one project.

Use the answer your existing tool gives you. When a further question needs
evidence it did not keep, add the Variance reading that can record it. The
runner still runs the suite, the visual service still reviews screenshots, and
your other tools keep the work they already do.
