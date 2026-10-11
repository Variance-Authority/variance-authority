## Problem

<!-- What was wrong or missing, in one or two sentences, apart from the fix.
Link the failing run, issue or line that shows it. -->

## Solution

<!-- What changed, in one or two sentences in the project's own concepts, no
paths: what a concept now is, does, or where it is held. -->

## Blocks

<!-- One row per block the change touches: a unit that changes for one reason.
Mark: Upgrade (modified), Extract (separated out so callers share it), Ghost
(new: nothing existing carries it), Acquire (a dependency brought in),
Deconstruct (removed). A Ghost or Acquire names what existing code it ruled
out, and why. Pinned by: the test that fails without the block, or the command
and result that show it. -->

| Mark | Block | Change | Pinned by |
| --- | --- | --- | --- |
|  |  |  |  |

<!-- When the change crosses packages, add a mermaid `flowchart TB` of the
touched packages: label a dependency it adds `+` and one it removes `−`. -->

## Assumptions

<!-- Delete when empty. Each choice between plausible alternatives, with the
alternative, and each review finding set aside, with why. One line each. -->

<!-- Last: the output of `yarn variance review --since origin/main --format
handover`, unedited. Review bots read it before CI has run. -->
