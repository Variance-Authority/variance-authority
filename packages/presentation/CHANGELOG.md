# @variance-authority/presentation

## 0.1.1

### Patch Changes

  - @variance-authority/dom@0.1.1
  - @variance-authority/react@0.1.1
  - @variance-authority/report@0.1.1

## 0.1.0

### Minor Changes

- 5b2a28f: Carry the caller-established font identities onto the presentation report.

  `sensePresentation` accepted a `fonts` option, threaded it into the capture it
  builds, then analyzed that capture and dropped it — so through the live door the
  option had no observable consequence: three different font lists produced a
  byte-identical report. The report now carries them, from the capture, so the
  pure entry point answers the same way.

  Fonts are a render input of the more consequential kind — a substitution moves
  every metric on the page without changing a byte of code — so the identities
  participate in `digest` and a reading taken under different ones is a different
  reading. `contentDigest` is untouched: content identity is what has to survive
  presentation moving. Absent rather than empty when none were established, and
  sorted, because the order a caller listed them in is not part of their identity.
