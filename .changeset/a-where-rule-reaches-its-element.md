---
'@variance-authority/dom': patch
---

A rule written inside `:where()` or `:is()` reaches the element it names

The capture keeps only the style rules that can match the subject, and it filed
each rule under the last compound of its selector. For
`:where(.docs-content h2)` it read that compound inside the arguments, took
`.docs-content`, and never tested the rule against an `h2`. The render then
painted the page without the rule, so the image came out shorter than the page
the browser laid out and every such page reported `subject-size-diverged`. A rule
is now filed by the compound outside any arguments or attribute values. A
document captured from a page whose styles wrap selectors this way keeps rules
it used to drop, so its digest changes once and its baseline renders again on
the next run.
