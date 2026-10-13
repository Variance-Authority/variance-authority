---
id: TASK-30
title: Refuse a render request whose body is not a render document
status: To Do
assignee: []
created_date: '2026-10-13 10:33'
updated_date: '2026-10-13 10:40'
labels: []
dependencies: []
references:
  - 'https://github.com/Variance-Authority/variance-authority/pull/334'
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The remote render server reads a request body as `JSON.parse(await readBody(request_)) as RenderDocument` (`packages/remote/src/renderer.ts`) and hands whatever arrives to the renderer. A body that is JSON but not a document fails somewhere inside the render, or renders something, rather than being refused at the door. The batch route is the same: it checks that `documents` is an array, then renders every entry unchecked. `isRenderDocument` in `@variance-authority/core/format` (`packages/core/src/format/shape.ts`) is the one owner of that shape check, and `@variance-authority/unit-test` already asks it of a capture file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A request whose body is JSON but not a render document is refused with a 4xx whose message says what was refused, and never reaches the renderer, pinned by a test in `packages/remote/src/renderer.test.ts` that fails on the code before the change
- [ ] #2 A body that is not JSON is refused with a 4xx on both the render and the batch route, instead of the 500 it gets today
- [ ] #3 A valid render document still renders as before
- [ ] #4 The check is `isRenderDocument`; no second shape check is written
- [ ] #5 An entry of a batch request that is not a render document settles as a failure whose reason says what was refused, never reaches the renderer, and leaves the other entries rendered
- [ ] #6 A changeset names the refusal for `@variance-authority/remote`
<!-- AC:END -->
