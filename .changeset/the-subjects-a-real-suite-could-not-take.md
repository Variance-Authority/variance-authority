---
'@variance-authority/unit-test': patch
'@variance-authority/dom': patch
'@variance-authority/core': patch
'@variance-authority/store': patch
'@variance-authority/cli': patch
'@variance-authority/eyes': patch
'@variance-authority/playwright-test': patch
---

Four ways a large unit tier lost subjects, none of which said so

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
