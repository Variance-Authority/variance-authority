# Test host

## What it is

The runner, harness or catalogue the adopter already uses to reach a state:
Playwright Test, Storybook, Vitest, Jest, or a module the adopter wrote. It
owns discovery, lifecycle, assertions, configuration and teardown.

## Good at

Knowing how to get to a state, and knowing the name of that state. A story id
and a test title are stable names the adopter already maintains, so **subject**
identity comes free.

## Bad at

Explaining a difference. A host can tell you a test failed; it holds nothing
that connects the failure to a component, an input, or a line.

## How it breaks

Its artifact and its configuration disagree — a built index that no longer
matches the stories on disk. Its parallelism reorders **subjects** so a
cross-**subject** effect appears and disappears between runs. It retries, and
the retry destroys the disagreement that was the finding.

## How you talk to it

Additively, and never as a replacement. The integration contributes an
observation and exports no `test`, no `expect`, no configuration and no
lifecycle. Where the host produces an artifact — a Storybook index — that
artifact is read as a value rather than its configuration re-executed.

## Their chart

—
