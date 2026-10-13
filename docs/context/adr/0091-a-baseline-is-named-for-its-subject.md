# ADR-0091 — A baseline is named for its subject, and the record names the machine

**Status:** accepted
**Date:** 2026-10-14
**Amends:** [ADR-0011](0011-durable-and-ephemeral-retention.md)'s
`<root>/<identityDigest>/…` (the identity leaves the path; it keys the render
cache and is read from the record);
[ADR-0016](0016-where-a-baseline-is-kept-decides-nothing.md)'s rule that the
partition is preserved by delegation (the delegation stays, and what is
delegated is now the template);
[ADR-0090](0090-a-moved-identity-is-a-cause-not-a-verdict.md) §6 (a line is one
engine family, not one engine family on one platform at one scale)
**Discharges:** [spec 0011](../../specs/0011-storage-and-cache-primitives.md)
item 2
**Relates to:** [`packages/store/src/path-template.ts`](../../../packages/store/src/path-template.ts),
[`packages/store/src/durable.ts`](../../../packages/store/src/durable.ts),
[`packages/store/src/legacy.ts`](../../../packages/store/src/legacy.ts),
[`packages/raster/src/key.ts`](../../../packages/raster/src/key.ts)

## Context

Under `directory` or `lfs` with a tracked root, a baseline is reviewed as a file
in a pull request. The pull request lists paths, and the path was
`v1-6c1f…/story%3Acomponents-button--primary.png` under `flat` or
`src/ui/Button/v1-6c1f…/story%3Ahatbar--accepted-hats.png` under `beside`: a
32-character hex directory and a percent-encoded id. Nobody reading a diff can
check either against the change, and every machine that accepted wrote a second
directory of the same images. `beside` placed by the subject's directory, not
by its file, and a closed union of two words was the only choice an operator
had (spec 0011 §5).

The digest was in the path because ADR-0011 made the partition the lookup's
first line of defence: an image painted elsewhere was not where the lookup
looked. ADR-0090 removed the reason. A baseline from another identity is
compared, and the record's identity, not the path's, names what moved. The
path kept a job it no longer did.

Prior art converges on one shape. Playwright's `snapshotPathTemplate` renders
`{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}`:
the declaring file, the assertion's name, and a *declared* project name — never
a machine digest — with the platform as an opt-in suffix. jest-image-snapshot
writes `__image_snapshots__/` beside the test with a name from the test title
and a counter. Loki files `<configuration>_<kind>_<story>.png` under one
directory. The shared choice is a readable name from the test or story, beside
the code or in one tree, and the renderer named by what the operator declared.
The counter is the one part this ADR refuses.

## Decision

**A file-backed baseline is at `<root>/<template>.png|.json`. The template
renders what the subject is; the record says what painted it.**

1. **`baselines.path` is a template.** Tokens: `{dir}` and `{file}` (the file
   that declares the subject, from the repository root), `{title}` (the story
   title or the test's `describe` path), `{name}` (the story or test name),
   `{id}` (the whole subject id) and `{engine}` (the declared engine family).
   `{dir}` and `{title}` spread to directories and stand alone in a segment.
   The default is `{title}/{name}-{engine}`; collocation is
   `{dir}/__baselines__/{file}/{name}-{engine}`. A label is spelled
   `name__label`. A template without `{name}` or `{id}` is refused at parse,
   because two subjects of one title could not be told apart.
2. **No digest in a committed path.** At most the engine family, which the
   operator declared. Platform, scale factor, fonts and recipe are in the
   record, and a mismatch is read and compared under ADR-0090 with the field
   named as the cause.
3. **A collision stops the run, naming both subjects and both spellings.**
   Paths are claimed case-folded, at `expect` before anything is observed and on
   every lookup and write. Nothing is renumbered: a suffix decided by plan order
   hands an approved image to the other subject when the order changes.
4. **`{file}` and `{dir}` are checked, never cleaned.** A cleaned path names a
   file that does not exist. An absolute path, `..`, `.` or an empty segment is
   refused, and so is a subject no file declares under a template that needs
   one. Every other token is cleaned to letters, digits, `.`, `_` and `-`.
5. **The identity-directory layout is read, compared and moved.** A lookup that
   misses the template's path reads the old pairs, nearest identity first, and
   reports `relocated {from, to}`; the verdict is unchanged or changed, never
   `new`, and the move is in `because`. A write puts the pair at the template's
   path and then retires the old one, so the accepting pull request shows a
   rename. A relocated subject is rendered rather than settled, because a
   settled subject produces no observation for an accept to move.
6. **The template is parsed once and delegated.** `createLfsStore` computes no
   path; its `.gitattributes` pattern and the commit-back pathspecs come from
   the template's glob.
7. **The keys carry what the template needs.** `BaselineKey` gains `file`,
   `title` and `name` and loses `path`; Storybook's index, the Playwright
   fixture (`titlePath`) and the Vitest plugin (`testPath`, `titlePath`) supply
   them. The render cache stays keyed by identity and document digest, outside
   the tracked root.

## Consequences

- **One file per engine family.** A laptop and a Linux runner on Chromium write
  the same file, and the last accept wins; the other reads it as `changed` with
  the platform named. ADR-0090 §6's "a laptop and a Linux runner keep one each"
  no longer holds. The advice it already gave — one pinned painter for laptop
  and CI — is now the only arrangement that does not alternate.
- **Two Playwright projects that differ only in scale factor, colour scheme or
  viewport share one baseline.** They need distinct subject ids, as colour
  scheme and viewport already did.
- **A template edit or a file rename is a re-record.** The old file reads `new`
  for the subject and is reported unplanned. This is spec 0011 §5's co-location
  cost, now true of `{title}` and `{name}` as well as `{dir}`.
- **`unplanned` walks the root.** Under a root of `.` that is the repository,
  pruned of `node_modules` and dot-directories.
- **The LFS pattern is the template's glob.** `*-*.png` for the default, which
  under a repository root also takes unrelated hyphenated PNGs;
  `**/__baselines__/*/*-*.png` for collocation.
- **`packages/observe/src/parity.test.ts` runs a collocated durable store**
  beside the four backends, and asserts the one answer ADR-0016 requires.

## What this forecloses

A hex digest, a counter or a platform in a committed baseline path, and a
layout an operator cannot name.
