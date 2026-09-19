# Start with the question in front of you

Pick the question that brought you here. Each path below tells you what evidence
it needs, what answer it can produce, and where that answer stops. Use one path
on its own or combine several as the investigation grows.

**Variance Authority** keeps fine-grained evidence of what your code did —
across hundreds of thousands of files and tests, over time — so that a question
is answered from that record instead of by running the whole suite again to find
out. The record has several readings, and none of them is the centre the others
depend on.

## What do you need to do?

<div class="doc-link-grid doc-link-grid--capabilities">
<a class="doc-link-card doc-link-card--compact" href="agent-workspace-api.md">
<span>Source</span>
<strong>Help an agent understand this codebase</strong>
<p>Read the packages a TypeScript workspace publishes, their symbols and signatures, and the places those symbols are already used.</p>
<em>Inspect the workspace API →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="agent-interrogate.md">
<span>Live test</span>
<strong>Find out why this test is stuck</strong>
<p>Stop a Playwright test at a line you chose and inspect the page and announced work while that exact test is still running.</p>
<em>Interrogate the test →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="selecting.md">
<span>Selection</span>
<strong>Run the tests this edit can reach</strong>
<p>Combine source relationships with recorded execution to select affected test files and explain every selection.</p>
<em>Focus the next run →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="distill.md">
<span>Test reduction</span>
<strong>Make one test smaller</strong>
<p>Find loaded modules and rendered components the test did not use, try one substitution, and confirm it with the same test.</p>
<em>Distil a test →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="presentation.md">
<span>Interface</span>
<strong>Measure what a UI edit changed</strong>
<p>Inspect grouping, spacing, alignment, emphasis, and repetition on the live page before and after an edit.</p>
<em>Inspect presentation →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="explain-variance.md">
<span>Change investigation</span>
<strong>Explain a visible change</strong>
<p>Keep text, accessibility, layout, styles, and pixels separate, then trace the changed region to its component and source.</p>
<em>Explain the variance →</em>
</a>
</div>

## Give your coding agent the same evidence

The agent does not need a special runner or editor. Variance exposes source and
observations through the shell and MCP; its skills take common investigations
through an edit and a check.

<div class="doc-link-grid doc-link-grid--capabilities">
<a class="doc-link-card doc-link-card--compact" href="agent-cli.md">
<span>CLI</span>
<strong>Ask from the shell</strong>
<p>Query the current workspace, a completed report, or a live watcher from the command line the agent already has.</p>
<em>Use the command line →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="agent-mcp.md">
<span>MCP</span>
<strong>Keep the investigation connected</strong>
<p>Expose the observations you supply as callable tools, including a test paused at an authored inspection point.</p>
<em>Connect an MCP client →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="agent-workflows.md">
<span>Agent workflows</span>
<strong>Take the work through a check</strong>
<p>Choose a guided workflow for source discovery, live investigation, UI review, test selection, or test reduction.</p>
<em>Choose an agent workflow →</em>
</a>
</div>

## Start from the tools you already use

For rendered comparison, keep the harness that already puts the app in that
state: [Playwright](start-playwright.md), [Storybook](start-storybook.md),
[application routes](start-routes.md), [Jest or Vitest](start-unit.md), [Vitest
browser mode](start-vitest-browser.md), [Rstest](start-rstest.md), or [a custom
collector](start-custom.md). [Observe one state](start.md) takes a single UI
state through capture, review, and explicit acceptance before you decide how
much of the suite belongs in the workflow.

Source discovery needs only a readable TypeScript checkout. Test selection and
reduction need an [execution record](execution-record.md). Live investigation
needs a watcher running before the suite starts. Each guide states the evidence
it can read and leaves an unavailable reading absent instead of turning it into
a result.

## Understand the model when you need it

[Tests preserve the paths we care about](tests.md) explains what a passing test
can and cannot establish. [See what changed](changed.md) explains why Variance
keeps the beginning, middle, and end of a change available. [The reasoning
loop](reasoning.md) shows how to choose the smallest reading that can answer a
question, and [the evidence field](evidence-field.md) maps the readings a run
can leave behind.

For exact package contracts, use the [package reference](../packages). For the
system boundaries and ownership model, use [architecture](architecture.md).
