# Why a layer is worth a line in review

**Date:** 2026-09-30

`variance layers` and `variance restrictions` shipped without an argument for
why anyone should care that a package changed layer. This entry read the prior
art for one. The structural argument holds. No measurement of an effect exists,
and `docs/boundaries.md` claims none.

Method: web sources only, mostly secondary summaries; the Lakos book was not
opened. Every claim below names where it came from.

## What holds

- **A loop-free hierarchy makes subsets usable alone.** Dijkstra's THE system
  (EWD196) tests each level assuming the ones below are correct. Parnas (1979)
  requires the "uses" relation to be loop-free so that useful subsets exist, and
  says the hierarchy matters only if you care about subsets. Lakos calls a design
  with such a hierarchy levelizable. A new import is therefore a decision about
  which subsets stay possible.
- **Every sibling tool encodes the same idea.** Nx tags libraries with `scope:`
  and `type:` and checks `depConstraints` (nx.dev, enforce-module-boundaries).
  Deptrac, Bazel visibility, Java modules (JEP 261) and eslint-plugin-relations
  state a direction and check it per change. Ford's fitness functions are the
  practice: check an architectural property on every change, not in an audit.
- **A computed layer needs no declared taxonomy.** Nx's layer is a tag someone
  keeps right. ArchUnit's guide warns that configuration must match intent or
  violations pass, and offers freezing so old violations stop failing. A layer
  read off the graph cannot disagree with the graph. This is the difference the
  page leads with.

## What does not hold

- **No evidence ties layer count or depth to build time, defects or change
  cost.** The one supported effect is about cycles: components that move between
  dependency cycles are more defect-prone (abstract only, not opened). One
  study found deeper Maven dependencies are less likely to break clients on
  upgrade, the opposite of "more layers, more risk".
- **Layer is not stability.** Martin's Stable Dependencies Principle counts
  dependants, not depth. A layer-1 package is the most costly to change,
  because most of the repository imports it. The page says layers count what a
  package needs and not what needs it.
- **The Law of Demeter is an analogy.** It is about object-level calls.
  eslint-plugin-relations cites it, but import rules between packages are not an
  application of it, so the page does not.
- **Level numbers from 1 are our choice.** Secondary summaries of Lakos did not
  confirm his numbering, so it is not credited to him.

## Test selection is a separate question

The static graph decides what Nx builds and schedules as affected. It does not
decide which tests Variance runs, because selection reads which tests ran the
changed code in a recorded run. Layers therefore make no claim about test
counts, and the page says so.

## Not found

No primary source on why rule files rot (tag taxonomies drifting, exemptions
growing). The reasoning that an allowlist reads as permission while a count reads
as debt came from issue threads only. It is the argument for reporting layer
changes instead of maintaining a rule file for them, and it is inference.

## Open

The CLI output says "moved with it" and "Carried". Those are the restricted
verbs in `docs/AGENTS.md`, and the CLI output is on the published surface.
Rewording them changes `layers-command.ts` and its tests; left for its own change.
