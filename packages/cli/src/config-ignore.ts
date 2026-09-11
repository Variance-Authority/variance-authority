import { validateIgnoreRule } from '@variance-authority/core/judge';
import {
  fail,
  nonEmpty,
  object,
  optionalText,
  quote,
  strings,
  type ParseOptions,
} from './config-values.js';

/**
 * The `ignore` section: subtrees and difference shapes this project is not testing.
 *
 * Its own module beside `config-sensitivity.ts` and `config-blank.ts`, which are
 * the other two settings that make a run see less. They are read together and
 * they are not interchangeable — an ignore says *this is not the subject*, a
 * sensitivity says *this subject is asserted on these bands*, and a blank says
 * *this asset never reaches the page at all* — so each one gets a file that can
 * argue its own trade rather than a section in a parser.
 */

/**
 * One ignore, as the operator writes it (spec 0024).
 *
 * The shape is the argument. Every field except `select` and `fingerprints`
 * narrows; those two are the only ones that make a rule *concrete*, and a rule
 * that carries neither is refused rather than applied to everything it lists —
 * because a rule scoped only by band is a tolerance, and this project does not
 * have those.
 */
export interface IgnoreConfig {
  /** Stable name. Appears in the report, and in every count this rule produces. */
  readonly id: string;

  /**
   * Why this is not the subject. Required, and refused when empty.
   *
   * The field that decides whether an ignore can ever be removed. Six months on
   * the only question anyone asks is whether it is still true, and a rule that
   * cannot answer gets kept out of superstition.
   */
  readonly reason: string;

  /** CSS selector, evaluated inside each subject. The subtree it picks is excluded. */
  readonly select?: string;

  /** Difference shapes, from a previous run's report. Survives layout changes. */
  readonly fingerprints?: readonly string[];

  /** Subjects this applies to. `*` matches any run of characters. Absent means all. */
  readonly subjects?: readonly string[];

  /**
   * Tags the subject must carry, as the artifact that produced it declared them.
   *
   * The declarative half. Storybook's built index carries a story's `tags`, so
   * `tags: ["volatile"]` scopes a rule to every story that says it is volatile —
   * next to the story, in the story's own words — instead of a list of ids in a
   * central file that goes stale the moment somebody renames one.
   *
   * Narrowing, and it **intersects** with `subjects` rather than adding to it: a
   * rule naming both applies where both hold. An ignore is the one setting that
   * makes a run less observant, so when two readings are available the narrower
   * one is correct, and two rules express a union perfectly well.
   *
   * A tag no subject carries is reported by name at the end of the run. A
   * misspelled tag is otherwise unrefusable — it is a word, and every word is a
   * legal one — so the only defence is saying which words nothing answered to.
   */
  readonly tags?: readonly string[];

  /** ISO date after which this stops absorbing and starts reporting. */
  readonly until?: string;
}

/**
 * Closed, and one field shorter than `core`'s own rule.
 *
 * `IgnoreRule.bands` exists and narrows what a rule absorbs — in `applyIgnores`,
 * over a pair of snapshots. The binary compares images against a stored baseline
 * and never builds that pair, so a `bands` written here would parse, validate,
 * appear to work and change nothing. It is not offered until something in a run
 * reads it; a config key with no consumer is worse than a missing feature,
 * because the operator believes they have it.
 */
const IGNORE_KEYS = ['id', 'reason', 'select', 'fingerprints', 'subjects', 'tags', 'until'];

/**
 * Parse and check the ignore list.
 *
 * Every rule is checked, and every problem is reported, rather than failing on
 * the first: a config with three bad ignores should take one edit to fix, not
 * three runs. The checks that are about *what an ignore is* live in `core`
 * (`validateIgnoreRule`) so that a library consumer composing the pipeline by
 * hand cannot route around them; what is added here is the file, the index, and
 * the one field `core` cannot see — a selector, which needs a DOM to mean
 * anything.
 */
export function parseIgnores(value: unknown, options: ParseOptions): readonly IgnoreConfig[] {
  if (!Array.isArray(value)) {
    fail('ignore', `must be an array of ignore rules, not ${quote(value)}`, options);
  }

  const rules = (value as readonly unknown[]).map((entry, index) => {
    const field = `ignore[${index}]`;
    const source = object(entry, field, IGNORE_KEYS, options);

    const id = nonEmpty(source, 'id', options, `${field}.id`);
    const reason = nonEmpty(source, 'reason', options, `${field}.reason`);
    const select = optionalText(source, 'select', options);
    const fingerprints = source['fingerprints'];
    const subjects = source['subjects'];
    const tags = source['tags'];
    const until = optionalText(source, 'until', options);

    if (fingerprints !== undefined) strings(fingerprints, `${field}.fingerprints`, options);
    if (subjects !== undefined) strings(subjects, `${field}.subjects`, options);
    if (tags !== undefined) strings(tags, `${field}.tags`, options);

    const rule: IgnoreConfig = {
      id,
      reason,
      ...(select !== undefined ? { select } : {}),
      ...(fingerprints !== undefined ? { fingerprints: fingerprints as readonly string[] } : {}),
      ...(subjects !== undefined ? { subjects: subjects as readonly string[] } : {}),
      ...(tags !== undefined ? { tags: tags as readonly string[] } : {}),
      ...(until !== undefined ? { until } : {}),
    };

    // `core` owns what an ignore may be; this file owns where the operator wrote
    // it. Re-deriving either half here is how the two would come to disagree.
    const problems = validateIgnoreRule(
      {
        id,
        reason,
        ...(rule.fingerprints !== undefined ? { fingerprints: rule.fingerprints } : {}),
        ...(until !== undefined ? { until } : {}),
      },
      { hasPlace: select !== undefined },
    );
    for (const problem of problems) fail(field, problem, options);

    return rule;
  });

  const seen = new Set<string>();
  for (const rule of rules) {
    // Refused rather than merged. Two rules under one id produce one line in the
    // register covering two decisions, and an operator deleting the flake it
    // names would silently leave the other one absorbing.
    if (seen.has(rule.id)) fail('ignore', `has two rules with the id ${quote(rule.id)}`, options);
    seen.add(rule.id);
  }

  return rules;
}
