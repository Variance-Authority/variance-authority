import type { Level } from '@variance-authority/core';
import { fail, nonEmpty, object, quote, strings, type ParseOptions } from './config-values.js';

/**
 * The `sensitivity` section: how much of a subject is asserted on at all.
 *
 * Its own module rather than a third section of `config-sections.ts`, and the
 * reason is the 500-line rule doing its job — that file crossed the line the day
 * this was added to it. What the rule found is real: `ignore` and `sensitivity`
 * are read together and mean opposite things, and a reader arriving at either
 * one should land on a file that explains the *pair* rather than on section
 * three of a parser.
 */
const SENSITIVITY_KEYS = ['id', 'reason', 'level', 'subjects', 'tags'];
const LEVELS: readonly Level[] = ['strict', 'layout', 'content'];

/**
 * Parse and check the sensitivity list.
 *
 * Deliberately a sibling of `parseIgnores` rather than a mode on it, because the
 * two say opposite things and reading them side by side is how an operator keeps
 * that straight. An ignore names *what is not the subject* — a clock, a shape. A
 * sensitivity names *what this subject is asserted on at all*, positively, and
 * the inversion into the bands it absorbs happens in `core` where the register
 * can count it.
 *
 * `reason` is required for the same reason an ignore's is, and it is the field
 * most likely to be resented: a route declared `layout` two years ago by
 * somebody who has left is a blind spot with a plausible-looking config entry in
 * front of it. The level is closed to three names so that a report can explain
 * what one meant; an open vocabulary would put the definition in a config file
 * and out of reach of the sentence that prints it.
 */
export function parseSensitivities(
  value: unknown,
  options: ParseOptions,
): readonly SensitivityConfig[] {
  if (!Array.isArray(value)) {
    fail('sensitivity', `must be an array of sensitivity rules, not ${quote(value)}`, options);
  }

  const rules = (value as readonly unknown[]).map((entry, index) => {
    const field = `sensitivity[${index}]`;
    const source = object(entry, field, SENSITIVITY_KEYS, options);

    const id = nonEmpty(source, 'id', options, `${field}.id`);
    const reason = nonEmpty(source, 'reason', options, `${field}.reason`);
    const level = nonEmpty(source, 'level', options, `${field}.level`);
    const subjects = source['subjects'];
    const tags = source['tags'];

    if (!LEVELS.includes(level as Level)) {
      fail(
        `${field}.level`,
        `must be one of ${LEVELS.map((name) => quote(name)).join(', ')}, not ${quote(level)}`,
        options,
      );
    }

    if (subjects !== undefined) strings(subjects, `${field}.subjects`, options);
    if (tags !== undefined) strings(tags, `${field}.tags`, options);

    // A rule that names neither is every subject in the project, which is a
    // run-wide relaxation wearing a rule's clothes — the thing the declaration
    // form exists to prevent. `strict` is exempt because it relaxes nothing and
    // is how an operator writes an exception back *inside* a broader rule.
    if (subjects === undefined && tags === undefined && level !== 'strict') {
      fail(
        field,
        'must name `subjects` or `tags`; a sensitivity that applies to everything is a ' +
          'run-wide setting, and this project does not have one — see docs/ignores.md',
        options,
      );
    }

    return {
      id,
      reason,
      level: level as Level,
      ...(subjects !== undefined ? { subjects: subjects as readonly string[] } : {}),
      ...(tags !== undefined ? { tags: tags as readonly string[] } : {}),
    };
  });

  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      fail('sensitivity', `has two rules with the id ${quote(rule.id)}`, options);
    }
    seen.add(rule.id);
  }

  return rules;
}

export interface SensitivityConfig {
  readonly id: string;
  readonly reason: string;
  readonly level: Level;
  readonly subjects?: readonly string[];
  readonly tags?: readonly string[];
}
