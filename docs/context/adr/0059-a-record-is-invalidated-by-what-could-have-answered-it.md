# ADR-0059 — a record is invalidated by what could have answered it

**Status:** accepted
**Date:** 2026-09-13
**Relates to:** [journal 0047](../journal/0047-one-added-file-cost-a-whole-repository.md), [journal 0043](../journal/0043-the-index-was-being-rebuilt-to-change-ten-files.md)

## Context

A source record holds a file's resolved edges. Its bytes do not determine it:
where `./button` points depends on what sits around the file, on `tsconfig`
`paths`, and on what is installed. So a cached record needs a second key beside
the content digest, naming everything other than the bytes that the edges depend
on.

The first version of that key was a digest of every tracked path. It is sound and
it is four lines, and it charges a full rebuild for one added file — 24,909
records on `mui/material-ui` to answer a question about one path. A repository
busy enough to want an index moves a path every few minutes, so the index was
warm only between landings.

The temptation at that point is to weaken the key: watch only where requests
landed, or only the scanned directories, or hold records across a move and hope.
Each of those produces edges that were true of a repository that no longer
exists, and an edge nobody can trace back to a file is worse than a slow scan.

## Decision

**A record's non-content key is the configuration it resolved under, plus the
directories its own specifiers could have been answered from. Nothing wider, and
nothing derived from the answers alone.**

Three parts, each load-bearing.

**Configuration is repository-wide, and named by contents.** Manifests,
lockfiles, every `tsconfig`/`jsconfig`, the requested `tsconfig`, and the
condition names. One `paths` entry redirects every `@/` specifier there is, so
there is no narrower answer than everything, and a change to any of them rebuilds
the repository. This is the old rule, kept, for the inputs it was always right
about.

**Witnesses are lexical, derived from the specifier and not from the answer.**
`./button` from `src/panel` witnesses `src/panel` and `src/panel/button`, whether
or not anything answered. The request that resolved to nothing is the one most
likely to start resolving, and a rule that watched only edges would never look at
it. Where a request did resolve, the directory holding the answer is a witness
too — a `package.json` `main` can send a lookup somewhere no reading of the
specifier predicts.

**No bound is stated as no bound.** A bare specifier is bounded by the `paths`
and `baseUrl` the tracked configurations declare. When one of them cannot be read
— invalid JSON, or an `extends` naming a package that lives in `node_modules` —
there is no honest bound, and the whole path set goes into the configuration
digest. The old behaviour becomes the fallback rather than the rule, applied to
the repository that earned it.

A directory is named by the sorted list of entries it holds, so the check is a
set membership test against the directories that moved, and a run where none
moved does no work at all. The witnesses are stored beside the record rather than
recomputed, because they come from specifiers in a parse that a reusing run never
opens.

## What this forecloses

- **Reusing a record across a move you did not bound.** Every widening of what a
  specifier can reach — a new alias syntax, a resolver plugin, a manifest field
  that redirects — must either produce witnesses or return no bound. Silence is
  not an option, and a plausible guess is the failure this forecloses.
- **Deriving invalidation from resolved edges.** They are the answers, and the
  question is what could have answered differently.
- **A record key that cannot be checked without re-reading the file.** Witnesses
  are persisted for exactly this reason; a key needing the parse back costs the
  read the reuse exists to avoid.
- **Treating the `.gitignore` gap as closed.** The tree comes from git, so a file
  appearing under an ignore rule moves no directory and can in principle shadow a
  resolution. It is bounded by `git add` and turned off entirely by `digests:
  false`, and it is a known hole rather than an oversight.

It does not foreclose a wider fallback being chosen deliberately. What it
forecloses is a narrow key that cannot say why it is narrow.
