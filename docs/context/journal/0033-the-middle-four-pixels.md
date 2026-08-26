# Journal 0033 — The middle four pixels

**Date:** 2026-08-26

The first spacing correction found the Underwriter page's broad rhythm and still
missed the relationship shown in the supplied crop. It compared the 11.19px gap
between demand articles with the 4px median inside each article. Those classes
were distinguishable, so the reading stopped.

The article had another level. A document label led a sequence of same-shaped
field blocks. Its gap to the first field was 4px, and every field-to-field gap
was also 4px. Inside each field, label-to-value spacing was 2px. The implemented
comparison had jumped from 11.19px to 4px and skipped the middle relation:

```text
article → article       11.19px
label → first field      4px
field → next field       4px
field label → value      2px
```

The equal middle steps are now `SPACING_HIERARCHY_COLLISION`. The rule requires
a distinct leading semantic class followed by at least two same-class body
peers, then compares the leading-to-body separation with body-to-body
separations across repeated instances. It creates no preferred margin. On the
archive it produced five findings covering the five inferred demand patterns;
each reported a 4px median on both sides and a ratio of 1.

Finding paint draws the two measured relations for each affected instance. An
article outline had shown where the box was but not why its hierarchy collapsed;
the paired lines show the equal steps directly.
