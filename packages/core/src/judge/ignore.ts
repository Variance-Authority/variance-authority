import type { Band } from '../compare/band.js';
import { aggregateImpact } from '../compare/impact.js';
import { componentsOf } from '../compare/diff/components.js';
import { impactTag, type Delta, type Root } from '../compare/diff/delta.js';
import type { SemanticDiff } from '../compare/diff/index.js';
import type { Digest } from '../format/hash.js';
import { fingerprintOfRoot } from './fingerprint.js';
import type { IgnoreSite } from '../format/snapshot.js';
import { appliesToSubject, isExpired, isUnder } from './scope.js';

export type { IgnoreSite } from '../format/snapshot.js';

/**
 * Ignores, and the accounting that stops one becoming a blind spot (spec 0024).
 *
 * The README refuses tolerances, and it is right to: a tolerance is an anonymous
 * number that hides whatever fits underneath it, chosen by whoever wrote the
 * default. An ignore is the opposite of that in every respect that matters, and
 * the difference is enforced here rather than asserted in a document:
 *
 * - it names a **place** or a **shape**, never a magnitude;
 * - it carries a **reason**, and a rule without one is refused;
 * - it says how much it absorbed, in how many subjects, every run;
 * - it is **reported when it absorbs nothing**, because an ignore that outlived
 *   its flake is a hole in the suite nobody can see;
 * - it never produces `unchanged`. A subject whose every difference was absorbed
 *   is a subject that was *ignored*, and the two words are not interchangeable.
 *
 * That last rule is ADR-0002's, applied to a second reason for not having looked.
 * A profile that cannot observe a band reports `unobserved` rather than passing
 * it; an operator who declined to look at a region gets the same treatment, for
 * the same reason — a green subject that is indistinguishable from a genuinely
 * unchanged one makes every count on this page decorative.
 *
 * ## Two ways to name what is not the subject
 *
 * **By place.** A subtree, resolved once by whatever held the document, arrives
 * here as an {@link IgnoreSite}: a path, and the box it occupied. One declaration
 * serves both tiers — the semantic tier drops deltas under the path, the raster
 * tier subtracts the box from the change mask — because two declarations would
 * let the tiers disagree about what the subject is, and a region that is ignored
 * semantically and compared on pixels reports `unexplained`, the highest severity
 * in the system, for something the operator already excluded.
 *
 * **By shape.** A {@link fingerprintOfRoot} is a digest of a difference with its
 * position and its values removed, so the same artifact anywhere in any subject
 * digests the same. An ignore keyed on one silences a known flake *without*
 * blinding the image it appears in: a different regression in the same place has
 * a different shape and is still reported. A coordinate mask cannot make that
 * distinction and never will, which is why no rule here accepts one: a rectangle
 * is a place that stops covering the thing it was drawn around the first time the
 * layout moves, and a selector is a place that does not.
 *
 * ## What is not here
 *
 * A band on its own. `bands` narrows a rule that already names a place or a
 * shape; a rule carrying only a band would be a tolerance wearing an ignore's
 * clothes, and {@link validateIgnoreRule} refuses it. Which bands *block* is a
 * different question with a different answer — `Policy.blocking` in `intent.ts`.
 */

export interface IgnoreRule {
  /** Stable name, used in the config, in the report, and by `IgnoreSite.rule`. */
  readonly id: string;

  /**
   * Why this is not the subject. Required.
   *
   * Not documentation. Six months on, the only question anyone asks about an
   * ignore is whether it is still true, and a rule that cannot answer it gets
   * kept out of superstition. Carried into the report so the answer is in front
   * of whoever is reading the failure it did not absorb.
   */
  readonly reason: string;

  /**
   * Subjects this applies to. `*` matches any run of characters. Absent means all.
   *
   * Narrow by default is the wrong default here and the right one to offer: a
   * flake that appears in one story should be silenced in one story, and an
   * operator who genuinely means "everywhere" can say so by omission — visibly,
   * in the same file.
   */
  readonly subjects?: readonly string[];

  /**
   * Difference shapes this absorbs. See {@link fingerprintOfRoot}.
   *
   * The form to prefer. It survives layout changes, applies across subjects
   * without listing them, and leaves the rest of the image being tested.
   */
  readonly fingerprints?: readonly Digest[];

  /** Narrows what the rule absorbs where it already applies. Never on its own. */
  readonly bands?: readonly Band[];

  /**
   * The place is the whole subject.
   *
   * The one way a rule may carry `bands` and no selector, and it has to be said
   * rather than inferred from their absence — because "no place" and "every
   * place" are the two readings of the same missing field, and one of them is the
   * tolerance this mechanism exists to refuse.
   *
   * Set by {@link import('./sensitivity.js').asIgnore} and by nothing else. A
   * sensitivity declares what a subject *is asserted on*, so its place genuinely
   * is the subject: "this route asserts on layout" absorbs every token-band
   * difference in it, wherever in it they land. The config parser does not accept
   * this key, so a hand-written ignore still cannot reach it.
   */
  readonly whole?: boolean;

  /**
   * ISO date after which this stops absorbing and starts being reported.
   *
   * Declared rather than inferred, so the default lifetime of a blind spot is
   * "until somebody decides again" instead of "forever". An expired rule is not
   * an error — the run proceeds and the differences it used to absorb come back,
   * which is the point.
   */
  readonly until?: string;
}

/** What one rule absorbed in one run. */
export interface AbsorbedByRule {
  readonly rule: string;
  readonly reason: string;
  readonly deltas: number;
  readonly subjects: readonly string[];
  readonly bands: readonly Band[];

  /**
   * The shapes this rule actually absorbed.
   *
   * The most useful field for an operator holding a place-scoped rule: it names
   * what that place was covering, so a whole excluded subtree can be narrowed to
   * the one shape that is actually noisy without anyone guessing a digest.
   */
  readonly fingerprints: readonly Digest[];
}

export interface IgnoreRegister {
  readonly absorbed: readonly AbsorbedByRule[];

  /**
   * Rules that absorbed nothing this run.
   *
   * Not a warning about the config file — a report about the suite. Either the
   * flake is fixed and the rule is a hole that should close, or the rule stopped
   * matching and something is being silently reported that the operator believes
   * is silenced. Both are worth a line.
   */
  readonly dead: readonly string[];

  /** Rules past their `until` date. They absorbed nothing, by construction. */
  readonly expired: readonly string[];

  /**
   * Subjects whose every difference was absorbed.
   *
   * The list that must never be folded into "unchanged". These are subjects that
   * differed and were not looked at.
   */
  readonly fullyAbsorbed: readonly string[];

  readonly totalAbsorbed: number;
}

export interface IgnoreOutcome {
  /** The diffs with absorbed deltas removed, in the order they were given. */
  readonly diffs: readonly SemanticDiff[];
  readonly register: IgnoreRegister;
}

export interface IgnoreOptions {
  /** Sites per subject id, as resolved against each candidate document. */
  readonly sites?: Readonly<Record<string, readonly IgnoreSite[]>>;

  /**
   * Today, as an ISO date, for `until`. Supplied rather than read.
   *
   * `core` has no clock — a package that reads one cannot be tested for what it
   * does on the day a rule expires, which is the only day the field matters.
   */
  readonly now?: string;
}

/**
 * Check a rule before it can absorb anything.
 *
 * Returns the problems rather than throwing, because a config carrying three bad
 * rules should report three, and because the CLI's config parser wants to attach
 * its own file and key to each one.
 */
export function validateIgnoreRule(
  rule: IgnoreRule,
  options: { readonly hasPlace?: boolean } = {},
): readonly string[] {
  const problems: string[] = [];

  if (rule.id.trim() === '') problems.push('needs an id');
  if (rule.reason.trim() === '') {
    problems.push(
      'needs a reason: an ignore nobody can evaluate later is one nobody will ever remove',
    );
  }

  // `hasPlace` is the caller's business because a place is resolved outside this
  // package: a selector needs a DOM. The rule this enforces is the same either
  // way — a rule that names no place and no shape absorbs everything its bands
  // cover in every subject it lists, which is a tolerance.
  const concrete =
    (options.hasPlace ?? false) ||
    rule.whole === true ||
    (rule.fingerprints !== undefined && rule.fingerprints.length > 0);

  if (!concrete) {
    problems.push(
      `"${rule.id}" names neither a place nor a shape, so there is nothing for it to be scoped ` +
        'to; an ignore that is only a band is a tolerance',
    );
  }

  if (rule.whole === true && rule.bands === undefined) {
    // `whole` with no band is every difference in the subject, which is not an
    // ignore — it is switching the subject off, and `subjects.exclude` says that
    // in a word a reader cannot mistake.
    problems.push(
      `"${rule.id}" covers the whole subject and narrows nothing, which silences it entirely; ` +
        'exclude the subject if that is the intent',
    );
  }

  if (rule.until !== undefined && Number.isNaN(Date.parse(rule.until))) {
    problems.push(`until must be an ISO date, not "${rule.until}"`);
  }

  return problems;
}

/**
 * The shape of one difference: its kind, its band, and which property moved.
 *
 * Everything positional and everything valued is deliberately absent. Two deltas
 * with the same shape are the same *kind of thing happening*, which is the
 * equivalence a flake needs and the one a coordinate cannot express.
 */
/**
 * Field separator inside a digest input.
 *
 * A byte that cannot occur in a component name, a property or a band, so no two
 * different shapes can concatenate into the same string. A space would collide
 * the moment a value contained one, which is the collision `digestCombine` uses
 * the same character to avoid.
 */
/**
 * Apply ignores to a run's diffs, and account for every difference absorbed.
 *
 * Runs after `diffSnapshots` and before `buildDocket`: the docket's arithmetic is
 * about which causes a reviewer signs off on, and a cause nobody is going to look
 * at should not be in it. Everything removed here is counted, attributed to the
 * rule that removed it, and reported.
 */
export function applyIgnores(
  diffs: readonly SemanticDiff[],
  rules: readonly IgnoreRule[],
  options: IgnoreOptions = {},
): IgnoreOutcome {
  if (rules.length === 0) {
    return { diffs, register: emptyRegister() };
  }

  const now = options.now;
  const expired = rules.filter((rule) => isExpired(rule, now)).map((rule) => rule.id);
  const live = rules.filter((rule) => !isExpired(rule, now));

  const tallies = new Map<string, Tally>();
  const fullyAbsorbed: string[] = [];
  const filtered: SemanticDiff[] = [];

  for (const diff of diffs) {
    if (diff.identical || diff.deltas.length === 0) {
      filtered.push(diff);
      continue;
    }

    const sites = options.sites?.[diff.subjectId] ?? [];
    const applicable = live.filter((rule) => appliesToSubject(rule, diff.subjectId));

    if (applicable.length === 0) {
      filtered.push(diff);
      continue;
    }

    // Fingerprints are per root, so they are resolved once per root rather than
    // once per delta: a root's shape is a property of the whole group, and asking
    // it repeatedly would make the digest cost quadratic in a wide change set.
    const fingerprints = new Map<Delta, Digest>();
    for (const root of diff.roots) {
      const digest = fingerprintOfRoot(root);
      for (const delta of root.deltas) fingerprints.set(delta, digest);
    }

    const absorbedBy = new Map<Delta, IgnoreRule>();

    for (const delta of diff.deltas) {
      const rule = applicable.find((candidate) =>
        absorbs(candidate, delta, sites, fingerprints.get(delta)),
      );
      if (rule !== undefined) absorbedBy.set(delta, rule);
    }

    if (absorbedBy.size === 0) {
      filtered.push(diff);
      continue;
    }

    for (const [delta, rule] of absorbedBy) {
      const tally = tallies.get(rule.id) ?? newTally(rule);
      tallies.set(rule.id, tally);
      tally.deltas += 1;
      tally.subjects.add(diff.subjectId);
      tally.bands.add(delta.band);
      const digest = fingerprints.get(delta);
      if (digest !== undefined) tally.fingerprints.add(digest);
    }

    const kept = diff.deltas.filter((delta) => !absorbedBy.has(delta));
    if (kept.length === 0) fullyAbsorbed.push(diff.subjectId);

    filtered.push(rebuild(diff, kept, absorbedBy));
  }

  const absorbed = [...tallies.values()]
    .map(finalizeTally)
    .sort((a, b) => b.deltas - a.deltas || a.rule.localeCompare(b.rule));

  const dead = rules
    .filter((rule) => !tallies.has(rule.id) && !expired.includes(rule.id))
    .map((rule) => rule.id);

  return {
    diffs: filtered,
    register: {
      absorbed,
      dead,
      expired,
      fullyAbsorbed,
      totalAbsorbed: absorbed.reduce((sum, entry) => sum + entry.deltas, 0),
    },
  };
}

/**
 * The register as the paragraph a reader is owed.
 *
 * Absorption first, because that is what changed the verdict; dead and expired
 * rules after it, because those are what the operator has to do something about.
 * A register with nothing in it returns the empty string rather than a cheerful
 * line — a run with no ignores should read exactly as it did before this existed.
 */
export function summarizeIgnores(register: IgnoreRegister): string {
  const lines: string[] = [];

  if (register.totalAbsorbed > 0) {
    lines.push(
      `${register.totalAbsorbed} difference(s) absorbed by ${register.absorbed.length} ignore(s).`,
    );
    for (const entry of register.absorbed) {
      lines.push(
        `  ${entry.rule}: ${entry.deltas} in ${entry.subjects.length} subject(s), ` +
          `${entry.bands.join('/')} — ${entry.reason}`,
      );
    }
  }

  if (register.fullyAbsorbed.length > 0) {
    lines.push(
      `  ${register.fullyAbsorbed.length} subject(s) differed and were entirely ignored: ` +
        `${register.fullyAbsorbed.slice(0, 3).join(', ')}` +
        (register.fullyAbsorbed.length > 3 ? ` (+${register.fullyAbsorbed.length - 3} more)` : ''),
    );
  }

  for (const rule of register.expired) {
    lines.push(`  [expired] ${rule} — past its date; it absorbed nothing and is now reporting`);
  }

  for (const rule of register.dead) {
    lines.push(
      `  [dead] ${rule} — absorbed nothing this run; either it is no longer needed, or it ` +
        'stopped matching and something is being reported that you believe is silenced',
    );
  }

  return lines.join('\n');
}

interface Tally {
  readonly rule: IgnoreRule;
  deltas: number;
  readonly subjects: Set<string>;
  readonly bands: Set<Band>;
  readonly fingerprints: Set<Digest>;
}

function newTally(rule: IgnoreRule): Tally {
  return {
    rule,
    deltas: 0,
    subjects: new Set(),
    bands: new Set(),
    fingerprints: new Set(),
  };
}

function finalizeTally(tally: Tally): AbsorbedByRule {
  return {
    rule: tally.rule.id,
    reason: tally.rule.reason,
    deltas: tally.deltas,
    subjects: [...tally.subjects],
    bands: [...tally.bands],
    fingerprints: [...tally.fingerprints],
  };
}

function emptyRegister(): IgnoreRegister {
  return { absorbed: [], dead: [], expired: [], fullyAbsorbed: [], totalAbsorbed: 0 };
}

/**
 * Whether a rule absorbs one delta.
 *
 * Order matters only for cost. A rule absorbs when it names *this* place or
 * *this* shape and the band, if it named any, is one of them — so a rule that
 * names nothing absorbs nothing, which is the property that keeps a config typo
 * from silencing a suite.
 */
function absorbs(
  rule: IgnoreRule,
  delta: Delta,
  sites: readonly IgnoreSite[],
  fingerprint: Digest | undefined,
): boolean {
  if (rule.bands !== undefined && !rule.bands.includes(delta.band)) return false;

  // Checked after the band and before any place, which is the order that makes
  // it safe: `whole` is only ever reached by a rule that has already narrowed to
  // the bands it absorbs, so "the whole subject" never means "everything in it".
  if (rule.whole === true) return true;

  if (fingerprint !== undefined && rule.fingerprints?.includes(fingerprint)) return true;

  return sites.some((site) => site.rule === rule.id && isUnder(delta.path, site.path));
}

/**
 * Rebuild a diff around the deltas that survived.
 *
 * Roots keep their own band and cause — filtering deltas out of a root does not
 * change what caused the rest of them — but a root left with nothing is dropped,
 * because a cause with no observed effect is not a review item. Components and
 * aggregate impact are recomputed from the survivors by the same functions that
 * built them, so a filtered diff cannot disagree with an unfiltered one about
 * what a given set of deltas implies.
 */
function rebuild(
  diff: SemanticDiff,
  kept: readonly Delta[],
  absorbedBy: ReadonlyMap<Delta, IgnoreRule>,
): SemanticDiff {
  const roots: Root[] = [];

  for (const root of diff.roots) {
    const deltas = root.deltas.filter((delta) => !absorbedBy.has(delta));
    if (deltas.length === 0) continue;
    roots.push(deltas.length === root.deltas.length ? root : { ...root, deltas });
  }

  return {
    ...diff,
    deltas: kept,
    roots,
    components: componentsOf(kept, roots),
    impact: aggregateImpact(kept.map(impactTag)),
  };
}
