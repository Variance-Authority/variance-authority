# Test host

## What it is

The runner, harness or catalogue the adopter already uses to reach a state:
Playwright Test, Storybook, Vitest, Jest, Rstest, or a module the adopter
wrote. It owns discovery, lifecycle, assertions, configuration and teardown.

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

Four things are asked of it: somewhere to transform product source before it
runs, a lifecycle around each observer to write down what that observer
entered, a stable name for the observer, and an end of the run to fold at. The
name is the host's own unit of scheduling — the file it hands a worker, the
story it shows one at a time — and the recording takes that unit rather than
imposing one of its own, which is why what a **crossing** joins is stated per
host and never normalized.

Going below that unit, to the individual test case, asks for a fifth thing: the
registrars the host installed. Where the host publishes them in more than one
place, every place is read, because which one a suite uses is the adopter's
configuration and never a condition to put back to them — an integration that
answers *set this option first* has taken ownership of the host by the other
door. A placement out of reach degrades to the unit above it, the answer the
host already had, and is carried as a defect rather than written down as a
limitation.

## Their chart

—
