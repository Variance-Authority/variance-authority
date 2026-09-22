# @variance-authority/route-collector

## 0.5.1

### Patch Changes

  - @variance-authority/dom@0.5.1
  - @variance-authority/playwright@0.5.1
  - @variance-authority/react@0.5.1

## 0.5.0

### Patch Changes

  - @variance-authority/dom@0.5.0
  - @variance-authority/playwright@0.5.0
  - @variance-authority/react@0.5.0

## 0.4.1

### Patch Changes

  - @variance-authority/dom@0.4.1
  - @variance-authority/playwright@0.4.1
  - @variance-authority/react@0.4.1

## 0.4.0

### Patch Changes

  - @variance-authority/dom@0.4.0
  - @variance-authority/playwright@0.4.0
  - @variance-authority/react@0.4.0

## 0.3.0

### Minor Changes

- fc59417: A subject id is what you type back, not what the build wrote

  Discovering routes from a directory of files gave `cart/empty.html` the id
  `cart/empty.html`, while the `index.html` beside it became `cart/`. A subject id
  is the name an operator types at `--subjects` and `variance accept`; carrying a
  file extension on one sibling and not the one next to it is a difference nobody
  asked for, and it made the ids depend on how the build chose to write the page
  rather than on which page it is.

  `.html` is now dropped from the id. The URL keeps it — that is what the server is
  actually asked for — and only the id changes. The root `index.html` still takes
  the id `/`.

  **Ids that move are baselines that no longer match.** A subject discovered this
  way under a previous version was stored under its `.html` id and will report
  `new` against the id without it. Accept the ids you meant and it stops happening;
  nothing is compared wrongly in the meantime, because an id with no baseline has
  never been a diff.

  **Two files that would answer to one id are now refused by name.**
  `cart/empty.html` and `cart/empty/index.html` both reduce to `cart/empty`, and
  whichever sorted last silently owned the baseline — the collector watched one page
  and reported the other. It exits `2` naming both files, and asks you to rename one
  or list the routes explicitly.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

### Patch Changes

  - @variance-authority/dom@0.1.1
  - @variance-authority/playwright@0.1.1
  - @variance-authority/react@0.1.1

## 0.1.0

First release.
