---
'@variance-authority/sense': minor
---

A story recorded under a document says what each test line did to the page

With `VARIANCE_AUTHORITY_STORY=1` and a `document` in Node, as under jsdom, the story watches the page and writes one note on each test line that changed it: `page +1 −0 nodes, 2 attributes, 0 text`, counted since the line opened. A line that changed nothing has no note, so a `findBy` or `waitFor` that passed on such a line waited on no change to the markup, unless it waited on a property such as an input's `value`. React commits stay with Eyes, which already writes each one under its step. What hooks and a testing library's cleanup change has no note. A run without a document, and any run that records no story, starts no watch; a test that runs in a browser page has no `page` note.
