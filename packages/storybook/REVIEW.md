# Reviewing `@variance-authority/storybook`

Parses a built Storybook's `index.json` into an ordered plan of subjects, and
drives a preview page somebody else opened from story to story over Storybook's
channel. `@variance-authority/storybook-collector` calls it.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/storybook/`.

## Contracts

- **One plan for one index.** Subjects and exclusions are sorted by title, name,
  then story id, never by key order. Pinned by
  [src/subjects.test.ts](src/subjects.test.ts) › "orders exclusions too, so one
  index yields one report twice running".
- **A skip is stated, never dropped.** A docs entry, an unknown type, an
  excluded tag, `exclude: true` or an override that cannot be completed lands in
  `plan.excluded` with its reason, and costs one subject, not the run. Written
  in [README › `toSubjects`](README.md#tosubjectsindex-options); pinned by
  [src/subjects.test.ts](src/subjects.test.ts) › "lets one bad parameter cost
  one subject, not the run".
- **Only a non-index is refused.** No `entries` or `stories`, a missing field
  or an id unlike its key is refused; an unknown `v` is read with a warning.
  Pinned by [src/index-file.test.ts](src/index-file.test.ts).
- **Ready is a signal, never quiet markup.** `rendered` comes from
  `storyRendered`, `currentRender` for the URL-selected story, or the
  `readySelector`, which once set is the only signal; a channel-less preview
  without one is refused. Written in [README › Readiness](README.md#readiness);
  pinned by [src/preview.test.ts](src/preview.test.ts) › "never calls a switched
  story rendered on its markup when Storybook says nothing".
- **A failure is its own story's outcome.** One outcome per asked id, in order;
  later stories are still shown; `error.from` blames `story`, `page` or
  `observer`; an unknown id is `missing`; `observe` sees only `rendered`.
  Written in [README › Drive a preview page you
  own](README.md#drive-a-preview-page-you-own); pinned by
  [src/preview.test.ts](src/preview.test.ts) › "a story that fails is a subject,
  not a crashed run".
- **No switch before `storyFinished`.** The next story is not shown while a
  render is in `afterEach`; a finish with status `error` stays `rendered` with a
  warning. Written in [README › The end of a
  render](README.md#the-end-of-a-render); pinned by
  [src/preview-finished.test.ts](src/preview-finished.test.ts).
- **Prepare is paid once per document.** A story the preview switched to reads
  `prepare` 0, never absent. Written in [execution record ›
  Phases](../../docs/execution-record.md); pinned by
  [src/story-timing.test.ts](src/story-timing.test.ts) › "gives the preview load
  to the first story, the story file to collect and the render to cases".

## Where to look for a counterexample

- `src/show-story.ts` runs rebuilt from its source text: a closed-over constant
  type-checks and throws in the browser. Try one outside `request`.
- The URL-selected story in `src/show-story.ts` and `src/finish-wait.ts` may
  have rendered or finished before anything listened. Try no `currentRender`, a
  render already in `afterEach`, one story asked twice on one page, and, in
  `src/story-timing.ts`, a timing watch installed twice.

The browser, the capture and the Suspense wait are
`@variance-authority/storybook-collector`'s.
