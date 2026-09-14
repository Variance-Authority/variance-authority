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

## 0.1.0

First release.
