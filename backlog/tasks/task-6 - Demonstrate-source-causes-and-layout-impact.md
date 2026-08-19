---
id: TASK-6
title: Demonstrate source causes and layout impact
status: Done
assignee: []
created_date: '2026-08-19 06:47'
updated_date: '2026-08-20 08:00'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a small runnable example that makes Variance’s answer concrete: a changed region is located in a sidebar, attributed to the component/source that changed, and separated from geometry effects such as a wider SidePanel or taller button. Keep structural change distinct from style and geometry rather than calling every visible move a style change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A browser-run example identifies a pixel region in a sidebar, names its React component and resolves it to the changed source file.
- [x] #2 The example distinguishes a style-only Heading change from geometry changes, including a SidePanel that is 50 CSS pixels wider and a button that is 4 CSS pixels taller.
- [x] #3 The example includes one structural/semantic change whose result is reported separately from style and geometry.
- [x] #4 Reader documentation states the showcase, the exact answer each scenario demonstrates, and the boundary between source cause, location, geometry, and structure.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a minimal React sidebar fixture with independently owned Heading, SidePanel, and ActionButton components. 2. Capture browser variants for a Heading paint/style edit, a 50px wider panel plus 4px taller button, and a sidebar landmark/tag change. 3. Assert the existing snapshot, region, Fiber, docket, and source-index paths distinguish cause, sidebar location, style, geometry, and structure. 4. Add the runnable example documentation and catalog entry, then verify browser behavior, static checks, and an independent documentation review.
<!-- SECTION:PLAN:END -->
