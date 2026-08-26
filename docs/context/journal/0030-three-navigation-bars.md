# Journal 0030 — Three navigation bars

**Date:** 2026-08-26

The explicit alignment reading was exercised through its public Playwright
entry points against three public pages at a 1440×1000 viewport. Each run sensed
the page's navigation boundary, selected one structural level of brand and
navigation controls, derived the median vertical centre, painted the retained
reading, and took a screenshot without another acquisition.

`paper.design` produced a 19-node report. Seven selected links shared a 30.5px
centre, so the spread was 0px. The public GitHub page for
`paper-design/agent-plugins` produced a 413-node report. Its brand and ten global
controls shared a 36px centre, again a 0px spread. `atlassian.com` produced a
944-node report. Five menu links shared a 34px centre while the brand link was at
36px, producing a 2px spread around a 34px median. The Atlassian markup also
exposed a `More` wrapper and nested content with matching semantics; excluding
both from that measurement kept the peer set at one structural level instead of
turning role matching into hierarchy.

The first Atlassian acquisition took 56.93 seconds. It waited on page-wide image
settlement and asked the DOM collector for React provenance on every captured
node, though the presentation report consumes neither outside images nor
provenance. Subject-scoped image settlement made all three public pages finish.
Removing the unused provenance traversal reduced the later Atlassian acquisition
to 3.35 seconds. The same later run took 3.57 seconds on Paper and 2.39 seconds on
GitHub. Paint used seven, eight and twelve deterministic instructions
respectively and did not reacquire the page.

The screenshots supplied both controls the API needed. The overlays touched only
the selected navigation flow; hero content and illustrations remained outside
the question. Paper and GitHub showed the aligned case, while Atlassian showed
the measurable mismatch. The tool therefore reports both outcomes with the same
operation and leaves whether two pixels matter to the product task.
