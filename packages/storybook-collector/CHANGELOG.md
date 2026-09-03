# @variance-authority/storybook-collector

## 0.1.1

### Patch Changes

- db08866: Keep the run when the execution journal cannot be recorded.
  
  `close()` already held the position that a journal is not the artefact under
  review: a recorder that declines to record is written to stderr and the run
  continues, because failing the run over it would cost every subject in it the
  baselines it just captured. Only the declining half was handled. A throw out of
  the same call — `duplicate test coverage observation` was the one reached in
  practice — went straight up through `close()` and took the run down with it.
  Both outcomes now end the same way, in a sentence on stderr and a run that keeps
  its images.
- Updated dependencies [fe578c8]
  - @variance-authority/sense@0.1.1
  - @variance-authority/core@0.1.1
  - @variance-authority/dom@0.1.1
  - @variance-authority/playwright@0.1.1
  - @variance-authority/react@0.1.1
  - @variance-authority/storybook@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [9587133]
- Updated dependencies [f800342]
- Updated dependencies [26ae9ed]
- Updated dependencies [f09528d]
- Updated dependencies [cfb333d]
- Updated dependencies [e8fee66]
- Updated dependencies [48d32eb]
- Updated dependencies [5c34e6d]
  - @variance-authority/sense@0.1.0
  - @variance-authority/dom@0.1.0
  - @variance-authority/react@0.1.0
  - @variance-authority/core@0.1.0
  - @variance-authority/playwright@0.1.0
  - @variance-authority/storybook@0.1.0
