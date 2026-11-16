---
'@variance-authority/sense': minor
---

A story recorded under a document says what each test line did to the page

With `VARIANCE_AUTHORITY_STORY=1` and a `document`, as under jsdom or happy-dom, the story watches the page and writes one note on each test line that changed it: `page +1 −0 nodes, 2 attributes, 0 text`, counted since the line before. A line that changed nothing has no note, so a `findBy` or `waitFor` on such a line waited for what was already there. React commits stay with Eyes, which already writes each one under its step. A run without a document, and any run that records no story, starts no watch.
