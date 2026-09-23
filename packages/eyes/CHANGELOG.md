# @variance-authority/eyes

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

### Patch Changes

- fc59417: Both halves must name the same test, and the same root

  `variance distill` joins two recordings that were made by different tools, and it
  joins them on exact equality. Two independent mismatches made that join fail, and
  neither of them said so.

  **The test id.** Sense keys a case by its coordinate — `<project-relative file> >
  <describe path and name>` — because a name is the coordinate. Eyes takes whatever
  id you hand it, and its collision error recommended the runner's own positional
  task id, which is the opposite: unique within a run, and moved the moment a case
  is inserted above it. Follow both pages and the third reading is unreachable, and
  the refusal named only the id you asked for — never the ids it held — so there was
  nothing in the output to compare. The refusal now prints the recorded count and up
  to five real ids beside it, and states the contract. The collision error asks for
  an id stable across runs and unique within one, and names where the journal will
  be joined.

  **The root.** Eyes records source provenance as absolute paths; sense records
  project-relative module files. Compared directly, nothing matched, and *the file
  that was addressed* therefore appeared in *the files with no addressed target* —
  the distillation opportunity list degenerated to every file the test entered,
  confidently and silently.

  `distill` takes an optional `root` (`--root` on the CLI, defaulting to the working
  directory) and reconciles the two shapes against it. Where it cannot, it withholds
  the list rather than printing a wrong one: if no addressed file matches any entered
  module under the given root, the two sides are rooted differently, and the output
  says so and offers nothing. Suffix matching was considered and rejected — it picks
  a winner among plausible matches and hides that it was choosing.

  A withheld list is the reading working. An opportunity list built on a root that
  does not reconcile is not a weaker answer than none; it is an answer that names
  every file you have.

## 0.2.0

### Patch Changes

- e546e21: Four ways a large unit tier lost subjects, none of which said so

  **The styling was gone before the capture looked.** A capture taken from a setup
  file runs in the outermost `afterEach` a run has; every hook registered inside a
  `describe` has already finished, and `onTestFinished` runs later still. CSS-in-JS
  teardown lives in exactly those inner hooks — emotion's test renderer removes each
  `<style>` tag it inserted — so the capture read the page with the styling taken
  back off it. The class names were all still in the markup, they matched nothing,
  and every subject captured, compared and passed against a photograph of unstyled
  DOM. Measured on Material UI's unit tier: 399 of 400 captures carried no CSS at
  all, and 1201 subjects laid out to zero height because nothing was sizing them.
  `retainStyles` records style elements as they are inserted and puts the removed
  ones back, in insertion order, for the length of one capture. The next test still
  gets a clean page.

  **A subject id can be longer than a filename.** A suite that names subjects after
  the test that produced them — a file path and a full test name — passes 255 bytes
  on ordinary tests, and the point of that convention is that the id says where the
  subject came from. `fileNameFor` in core is now the one rule: a readable prefix,
  plus a digest of the whole id when the id does not fit, because truncation alone
  merges two tests into one file. The baseline store, the capture archive, the
  CLI's image directory, the Playwright evidence directory and the Eyes journal all
  use it; before this, each was one long subject id away from a raw `ENAMETOOLONG`
  that never mentions a subject. `@variance-authority/eyes` declares
  `@variance-authority/core` directly rather than reaching it through `react` — the
  host stacks it keeps optional are Playwright and Testing Library, and a filename
  rule is not one of them.

  **An inline `url()` is spelled in entities.** `style="background-image:url(&quot;/a.png&quot;)"`
  reaches the scan through HTML serialization, and reading it literally asked the
  caller for bytes at a URL that exists nowhere but in the escaping. The HTML half
  is scanned with the attribute's entities undone; the stylesheet half, which was
  never escaped, is scanned as before.

  **A stubbed `getComputedStyle` is not a broken asset scan.** Replacing
  `window.getComputedStyle` with a map of the two properties a component reads is
  the only way to drive some layouts in jsdom. The scan called `getPropertyValue`
  on the plain object it got back, and every test in the file died on a `TypeError`
  raised four frames below anything you wrote. There is nothing to scan and nothing
  to complain about — whatever those styles would have named, the stub already
  removed from the page. The attributes on the element are still read.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- 26ae9ed: Distinguish the React component instance that initiated a commit from every
  component whose render body ran because of it.

  The commit tap retains `memoizedUpdaters` as bounded structural component paths,
  and Eyes records those commits in the authored test chronology. The MCP testing
  surface places update initiators inside or outside the component paths a test
  addressed while keeping whole-test source execution separate.

  Export bounded read-only Fiber subtree, parent-chain, component-path, and source
  location helpers for diagnostics that already hold a Fiber.
