# Spec 0006 — Storybook adapter

**Status:** `built` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md)

## Purpose

Take subjects from a project's existing Storybook rather than from a
purpose-written fixture. Story-shaped subjects already worked when this was
written; nothing read a real story index. `@variance-authority/storybook` now
does, and [`cases/storybook-case`](../../cases/storybook-case) runs the whole CLI
over an index `storybook build` produced. A real `.storybook` *configuration* is
still not read and is out of scope below.

## Contract

- Read the story index a built Storybook produces; each story is one subject,
  identified by its story id.
- Mount stories through Storybook's own rendering path, so a story that renders
  in Storybook renders here identically.
- Respect per-story parameters for viewport and for exclusion.

## Behaviour

**Storybook chrome is not the subject.** The preview iframe, its reset
stylesheet, and the addon panels are cruft and MUST be pruned before anything is
compared — this is the case ADR-0003 exists for, and a 1007-rules-to-1 reduction
is the expected shape of the result.

**One Storybook per run.** Reloading the iframe between stories is the
per-subject setup cost ADR-0009 refuses to pay. Stories share a session and
cross-pollution is detected rather than prevented.

**A story that throws is a reported subject, not a crashed run.**

## Acceptance

1. Subjects discovered from a real Storybook index match the story ids the index
   declares, with no fixture file involved.
2. Storybook's own chrome contributes no rules to any subject's applicable CSS.
3. A run over N stories launches one browser and performs one navigation.
4. A story that throws on render is reported with its error and does not prevent
   the remaining stories from being observed.

## Out of scope

- A Storybook addon panel.
- Storybook versions older than the one the project targets.
