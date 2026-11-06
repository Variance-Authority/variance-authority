# Reviewing `@variance-authority/storybook`

## Contracts

- **One plan for one index.** Pinned by
  [src/subjects.test.ts](src/subjects.test.ts).
- **A skip is stated, never dropped.** Written in [README ›
  `toSubjects`](README.md#tosubjectsindex-options); pinned by
  [src/subjects.test.ts](src/subjects.test.ts).
- **Only a non-index is refused.** Pinned by
  [src/index-file.test.ts](src/index-file.test.ts).
- **Ready is a signal, never quiet markup.** Written in [README ›
  Readiness](README.md#readiness); pinned by
  [src/preview.test.ts](src/preview.test.ts).
- **A failure is its own story's outcome.** Written in [README › Drive a preview
  page you own](README.md#drive-a-preview-page-you-own); pinned by
  [src/preview.test.ts](src/preview.test.ts).
- **No switch before `storyFinished`.** Written in [README › The end of a
  render](README.md#the-end-of-a-render); pinned by
  [src/preview-finished.test.ts](src/preview-finished.test.ts).
- **Prepare is paid once per document.** Written in [execution record ›
  Phases](../../docs/execution-record.md); pinned by
  [src/story-timing.test.ts](src/story-timing.test.ts).
