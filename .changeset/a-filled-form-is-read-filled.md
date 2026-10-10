---
'@variance-authority/dom': patch
'@variance-authority/route-collector': patch
'@variance-authority/storybook-collector': patch
'@variance-authority/playwright-test': patch
'@variance-authority/vitest-browser': patch
'@variance-authority/unit-test': patch
---

A form filled in after mount is painted and compared filled in

Text a play function or a test typed into an `<input>` or `<textarea>`, the
option it chose in a `<select>` and the box it ticked now reach the render
document and the snapshot. Before, the document painted the form as the server
sent it and the snapshot did not move for typed text or a chosen option. A
password field's value is carried as one `•` per character, and a file input's
value is not carried. A form nobody filled in reads exactly as before.

This is part of `RULESET_VERSION` `r2`. A subject whose form was filled in
after the server sent it has a new render document, so after this upgrade its
image shows the form filled in and reads `changed` against a baseline painted
empty; `variance accept --all` adopts it. A Playwright test painted its form
filled in before this change, so it does not move there.
