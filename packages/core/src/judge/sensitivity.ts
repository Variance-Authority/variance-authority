import { BANDS, type Band } from '../compare/band.js';
import type { SemanticDiff } from '../compare/diff/index.js';
import { applyIgnores, type IgnoreOptions, type IgnoreRule } from './ignore.js';

/**
 * How much of a subject is being asserted on, declared where it applies.
 *
 * A route-level test and a component-level test want opposite things from the
 * same machinery. A component's test asserts on everything: a colour token moved
 * and that is the change. A route's test asserts that the *page still assembles*
 * — the nav is where it was, the sidebar did not collapse, nothing overlaps — and
 * a design-system token landing in forty routes is noise it should never have
 * been shown. Run one policy over both and one of them is unusable: either the
 * routes are permanently red, or the components stop reporting the thing they
 * exist to catch.
 *
 * The usual answer is a second product, or a threshold, and both are worse than
 * the problem. What this offers instead is the same shape an
 * {@link IgnoreRule} has, because it is the same act: **naming what is not being
 * asserted on, where, by whom, and with the count in the report.**
 *
 * ## The unit is a band, and that is the whole design
 *
 * The frequency bands already say what *kind* of thing moved — `a11y`,
 * `geometry`, `token`, `content`, `texture` — and they are ordered by how rarely
 * they move and how much it matters when they do. "Assert on layout and ignore
 * small token updates" is not a tolerance, a percentage or a pixel count. It is
 * two band names.
 *
 * That is why this is not a threshold: a threshold absorbs *anything* small
 * enough, and a band absorbs exactly one kind of thing however large it is. A
 * route declared `layout` still reports a nav that moved by one pixel, and never
 * reports a rebrand that repainted every surface on the page.
 *
 * ## Why it is a declaration and not a mode
 *
 * The same reason an ignore is. A run-wide switch is a decision nobody attributes
 * and nobody revisits; a rule with an id, a required reason and a place is one a
 * reviewer can read six months later and disagree with. Everything an ignore owes
 * it owes: a reason, a scope, and a count of what it absorbed — including the
 * count of zero, which is how a declaration that has stopped being true is found.
 */

/**
 * A named set of bands worth asserting on.
 *
 * A closed set. Three names cover the cases that have argued for themselves and
 * a fourth would need one; an open set of user-defined levels would put the
 * vocabulary in a config file, where the report cannot explain what a word meant
 * to whoever wrote it.
 */
export type Level =
  /**
   * Everything. What a component's own test wants, and the default everywhere.
   *
   * Named rather than left implicit so a subject can be declared strict *back*
   * inside a route that is not — the exception a broad declaration always grows.
   */
  | 'strict'
  /**
   * The page still assembles: `a11y` and `geometry`.
   *
   * `geometry` is the obvious half — boxes appeared, vanished, moved or resized.
   * `a11y` is the half that gets left out and should not be: a control that lost
   * its accessible name is a structural regression that happens to repaint
   * nothing, and a route test that ignored it would be asserting on the shape of
   * the page while blind to the shape a screen reader sees.
   *
   * What it absorbs is `token`, `content` and `texture` — a restyle, a copy edit,
   * anti-aliasing. Each is a real change, each is reported as absorbed, and none
   * of them is what a route-level test is for.
   */
  | 'layout'
  /**
   * What the page *says*: `a11y` and `content`.
   *
   * For a subject whose styling is somebody else's to change — a themed embed, a
   * page inside a design system being actively rebranded — where the assertion
   * worth keeping is that the words and the semantics survived.
   */
  | 'content';

const LEVELS: Readonly<Record<Level, readonly Band[]>> = {
  strict: BANDS,
  layout: ['a11y', 'geometry'],
  content: ['a11y', 'content'],
};

/** The bands a level asserts on. Everything else is absorbed and counted. */
export function bandsOf(level: Level): readonly Band[] {
  return LEVELS[level];
}

export interface SensitivityRule {
  /** Stable name. Appears in the report and in every count this rule produces. */
  readonly id: string;

  /**
   * Why this subject is not asserted on in full. Required, as an ignore's is.
   *
   * The difference between a policy somebody chose and one that accreted. A
   * route declared `layout` two years ago by somebody who has left is a blind
   * spot with a plausible-looking config entry in front of it.
   */
  readonly reason: string;

  readonly level: Level;

  /** Subjects this applies to. `*` matches any run of characters. */
  readonly subjects?: readonly string[];

  /**
   * Tags the subject must carry, as its own artifact declared them.
   *
   * FIXME: read by nothing. `asIgnore` copies `subjects` and drops this, so a
   * rule scoped only by tags translates to an unscoped ignore and absorbs across
   * every subject in the run — the widest possible reading of the narrowest
   * scope an operator can write.
   */
  readonly tags?: readonly string[];
}

/** What one rule absorbed, per band, across a run. */
export interface Relaxation {
  readonly rule: string;
  readonly reason: string;
  readonly level: Level;

  /** Deltas absorbed because their band is not asserted on here. */
  readonly absorbed: number;
  readonly subjects: readonly string[];

  /** Which bands were absorbed, so a level can be tightened with evidence. */
  readonly bands: readonly Band[];
}

export interface SensitivityRegister {
  readonly relaxations: readonly Relaxation[];

  /**
   * Rules that absorbed nothing in any subject they applied to.
   *
   * The same accounting an ignore's register keeps, and for the same reason: a
   * route declared `layout` that has reported no token change in six months is
   * either a route nothing styles, or a declaration nobody needed. Both are worth
   * a line, and neither is visible without the count.
   */
  readonly dead: readonly string[];

  readonly totalAbsorbed: number;
}

export interface SensitivityOutcome {
  readonly diffs: readonly SemanticDiff[];
  readonly register: SensitivityRegister;
}

/**
 * Turn a sensitivity rule into the ignore it is.
 *
 * Not a shortcut — a statement about what these are. A sensitivity names a place
 * and narrows by band, which is exactly the shape `IgnoreRule` already refuses to
 * accept *without* a place, and exactly the shape it accepts with one. Sharing
 * the mechanism means sharing the safety property: the deltas are absorbed by
 * `applyIgnores`, counted per rule, and reported when a rule absorbs nothing.
 *
 * The bands are inverted on the way through, and that inversion is the whole
 * translation. A sensitivity says what it *asserts on*; an ignore says what it
 * *absorbs*. Stating the level positively is what makes a config readable — "this
 * route asserts on layout" rather than "this route ignores token, content and
 * texture" — and the negative form is what the machinery needs.
 */
export function asIgnore(rule: SensitivityRule): IgnoreRule | null {
  const asserted = new Set(bandsOf(rule.level));
  const absorbed = BANDS.filter((band) => !asserted.has(band));

  // `strict` asserts on everything, so it absorbs nothing and produces no rule.
  // Returning an ignore with an empty band list would produce a register entry
  // that is permanently dead, which is a line telling an operator to delete the
  // one declaration that is doing nothing wrong.
  if (absorbed.length === 0) return null;

  return {
    id: rule.id,
    reason: rule.reason,
    bands: absorbed,
    // The place is the subject, said rather than left to be inferred from a
    // missing selector — see `IgnoreRule.whole`.
    whole: true,
    ...(rule.subjects !== undefined ? { subjects: rule.subjects } : {}),
  };
}

/**
 * The register as the lines a run prints.
 *
 * Absorption is stated in the *positive* form the operator wrote, because that is
 * the sentence they can check: "asserts on layout" is a claim about intent, and
 * "absorbed 412 token deltas" is the evidence for or against it.
 */
export function summarizeSensitivity(register: SensitivityRegister): readonly string[] {
  if (register.relaxations.length === 0) return [];

  const lines = [
    `SENSITIVITY — ${register.totalAbsorbed} difference(s) not asserted on, ` +
      `by ${register.relaxations.length} rule(s)`,
  ];

  for (const entry of register.relaxations) {
    if (entry.absorbed === 0) {
      lines.push(
        `  [dead] ${entry.rule} — asserts on ${entry.level} across ` +
          `${entry.subjects.length} subject(s) and absorbed nothing (${entry.reason})`,
      );
      continue;
    }
    lines.push(
      `  ${entry.rule} — asserts on ${entry.level}; absorbed ${entry.absorbed} ` +
        `${entry.bands.join('/')} difference(s) in ${entry.subjects.length} subject(s): ` +
        entry.reason,
    );
  }

  return lines;
}

/**
 * Apply declared sensitivities to a run's diffs.
 *
 * A thin fold over {@link applyIgnores}, and thin on purpose: the absorption, the
 * per-rule counting and the dead-rule reporting are one mechanism, and a second
 * implementation of them would be a second set of bugs in the half of the system
 * whose whole job is not to silently hide things.
 *
 * Rules that resolve to `strict` are dropped before the fold rather than passed
 * through, so a project that declares its default explicitly does not collect a
 * permanently-dead register line for saying so.
 */
export function applySensitivity(
  diffs: readonly SemanticDiff[],
  rules: readonly SensitivityRule[],
  options: IgnoreOptions = {},
): SensitivityOutcome {
  const translated = new Map<string, SensitivityRule>();
  const ignores: IgnoreRule[] = [];

  for (const rule of rules) {
    const ignore = asIgnore(rule);
    if (ignore === null) continue;
    translated.set(rule.id, rule);
    ignores.push(ignore);
  }

  const outcome = applyIgnores(diffs, ignores, options);

  const relaxations = [...translated.values()].map((rule) => {
    const absorbed = outcome.register.absorbed.find((entry) => entry.rule === rule.id);
    return {
      rule: rule.id,
      reason: rule.reason,
      level: rule.level,
      absorbed: absorbed?.deltas ?? 0,
      subjects: absorbed?.subjects ?? [],
      bands: absorbed?.bands ?? [],
    };
  });

  return {
    diffs: outcome.diffs,
    register: {
      relaxations,
      dead: relaxations.filter((entry) => entry.absorbed === 0).map((entry) => entry.rule),
      totalAbsorbed: relaxations.reduce((sum, entry) => sum + entry.absorbed, 0),
    },
  };
}

/**
 * What a level does with a set of bands that moved.
 *
 * The arm for the path that holds no second document. `applySensitivity` folds
 * over deltas, which needs both revisions normalized; a `variance run` compares
 * an image against a stored baseline and has only what that baseline carried —
 * per-component hashes, one digest per band (ADR-0027, ADR-0029's split).
 * `bandsBetween` turns those into the same vocabulary, and this decides against
 * it, so the two paths agree by sharing {@link bandsOf} rather than by
 * inspection.
 *
 * **Empty in means nothing absorbed**, not everything. A run whose pixels moved
 * while every component hash held is raster residue — `texture`, which a
 * document cannot carry and which this must therefore never claim to have
 * decided. Absorbing on an empty set would turn the one band a hash comparison
 * is blind to into the one it silences.
 */
export function relaxes(
  level: Level,
  moved: readonly Band[],
): { readonly asserted: readonly Band[]; readonly absorbed: readonly Band[] } {
  const asserting = new Set(bandsOf(level));

  return {
    asserted: moved.filter((band) => asserting.has(band)),
    absorbed: moved.filter((band) => !asserting.has(band)),
  };
}

/**
 * Whether a subject's every moved band falls outside what it is asserted on.
 *
 * The whole subject, because that is the unit a stored baseline can answer for:
 * one image, one verdict. A subject where *some* moved band is asserted on is
 * reported in full — including the bands that would have been absorbed — since
 * a reviewer looking at a nav that moved wants the restyle that came with it,
 * and hiding half a diff is worse than hiding none of it.
 */
export function absorbsEntirely(level: Level, moved: readonly Band[]): boolean {
  return moved.length > 0 && relaxes(level, moved).asserted.length === 0;
}
