# Reviewing what the site publishes

The site at <https://variance-authority.dev> is how a person meets variance.
It publishes the top-level `docs/*.md` pages that
[`app/content/product-docs.ts`](app/content/product-docs.ts) imports, the
package READMEs that [`app/content/package-docs.ts`](app/content/package-docs.ts)
imports, and the copy in `app/`; the root README is the same reader's first page
on GitHub, and is held here too. This file adds to the root
[`REVIEW.md`](../REVIEW.md) for every change: a page that still says the old
thing is broken by that change, whichever file the diff edits. A finding on a
page quotes the sentence, and says what is true instead and how you know.

## Contracts

- **Every claim on a page is true of the head.** A command, a flag, a default,
  an output line or a number reads the way the code at the head runs, and a
  measured number names its machine. Written in
  [`docs/AGENTS.md` › The register](../docs/AGENTS.md#the-register) ("Every
  claim is checkable"). `tools/docs-cli.check.ts`, `tools/docs-options.check.ts`
  and `tools/docs-claims.check.ts` pin that the CLI, configs, packages and
  vocabulary a page names are real, and that every option is named. What a
  page says about them, and everything else it claims, is held by review: run
  it, or trace it to the line that makes it true.
- **A change of behaviour moves the page that describes it.** Search the
  published pages for every name, flag and output the change touches. Written
  in the `feat` row of [pull request](../.agents/references/pull-request.md);
  held by review.
- **Every sentence is in register.** Written in
  [`docs/AGENTS.md` › The register](../docs/AGENTS.md#the-register) and its
  [editorial direction](../docs/AGENTS.md#editorial-direction); held by review.
- **A page is not a work log.** No dates, no narrated absence, no other page's
  story, no comparison with an earlier version. Written in
  [`docs/AGENTS.md`](../docs/AGENTS.md#docs-is-not-a-work-log); internal
  links and history are pinned by `tools/docs-links.check.ts`, the rest is held
  by review.
- **A name the project made up lands on its owner page first.** Written in
  [`docs/AGENTS.md` › Every page is an entry
  point](../docs/AGENTS.md#every-page-is-an-entry-point); registered concepts
  are pinned by `tools/docs-entrypoints.check.ts`, and a new coined name the
  registry does not hold is a finding.
- **The documentation routes add navigation and figures, never a second
  contract.** Technical truth stays in the Markdown; copy on `/docs`, `/start`,
  `/agents` or `/reference` that states what the product does, and no Markdown
  page says, is a finding. Written in [README](README.md);
  `tools/docs-claims.check.ts` pins that a comparison is routed without
  duplicating the reference, and the rest is held by review.
