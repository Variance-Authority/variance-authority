# @variance-authority/scenario

## 0.10.0

### Patch Changes

- 6e5d53a: A file-backed baseline store files each baseline under a directory named for the renderer identity that painted it: a digest of the renderer, engine, platform, scale and fonts. That directory is now named `v1-<hex>`. It was named with the digest as written, `v1:<hex>`. NTFS refuses a colon in a file name, so a baseline root that still holds a `v1:` directory cannot be checked out on Windows, and `actions/upload-artifact` refuses to upload it. The render cache, which is in your cache directory unless `cacheRoot` says otherwise, now uses `v1-` for its identity directories and for each entry's file name.

  A store treats `v1:<hex>` and `v1-<hex>` as the same identity and reads both. When `v1-<hex>` has no baseline for a subject, the store looks in `v1:<hex>`. A baseline under another machine's identity, in either spelling, still makes the subject `incomparable`.

  `variance accept` writes each subject it accepts under `v1-<hex>` and deletes that subject's copy under `v1:<hex>`. It does not touch a subject whose pixels did not change, so a baseline that never changes stays under the old name, and the root stays unreadable on Windows until you move it. For each `v1:` directory, `variance doctor` prints how many baselines it holds and the `v1-` directory to move them into. Move the files with `git mv`. Render-cache entries under the old names are never read again, and the sweep every run applies to the cache deletes them.

  `@variance-authority/core/format` exports `digestFileName`, which spells a digest as a path segment, and `digestOfFileName`, which reads a digest back from either spelling.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Patch Changes

- 92f62d4: Name the `startScenario` option a host left out. `precondition` and `profile`
  are required and were read before they were checked, so omitting `precondition`
  answered `Cannot read properties of undefined (reading 'id')` from inside the
  module while `id` — required in the same way, on the same options object —
  already answered with a sentence. All three now do.
