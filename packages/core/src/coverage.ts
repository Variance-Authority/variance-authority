import type { ComponentHash } from './component-hash.js';

/**
 * Which subjects cover which components, and what each subject covers alone.
 *
 * A visual-regression suite accretes. A component gets a narrow subject of its
 * own, then appears inside four page subjects, then inside a dozen. Every one of
 * those subjects costs a capture on every run, and nothing in a per-subject tool
 * can say whether the narrow one is still earning its place — that question is
 * about the *set*, and no single subject knows it is a member of one.
 *
 * The two decisions this enables are opposites, and which one applies is a
 * judgement the data cannot make:
 *
 * - A component covered by many subjects may not need its own. Or the broad
 *   subjects may be the ones that should stop looking at it, so that a change
 *   inside it is reported once rather than a dozen times.
 * - A component covered by exactly one subject is the opposite risk. Deleting
 *   that subject removes the only thing watching it, and nothing else in the
 *   suite will notice when it breaks.
 *
 * **This never decides anything.** A component rendered in two contexts can be
 * correct in one and broken in the other, which is the entire reason contexts are
 * captured separately — so overlap is not redundancy, and a tool that deleted
 * subjects on this signal would remove real coverage on the strength of a name
 * matching. What is produced here is the list a person needs in order to make
 * that call, and the honest form of it is a count next to a name.
 *
 * Cheap by construction: it reads the component hashes a run already produced
 * (see {@link ./component-hash.js}) and touches no DOM, no browser and no image.
 */

/** What one subject was found to contain. */
export interface SubjectCoverage {
  readonly subject: string;
  readonly components: readonly ComponentHash[];
}

export interface ComponentCoverage {
  readonly component: string;

  /** Subjects containing at least one boundary of it, in the order supplied. */
  readonly subjects: readonly string[];

  /** Boundaries summed across every subject. Distinct from `subjects.length`. */
  readonly instances: number;

  /**
   * `true` when exactly one subject covers this component.
   *
   * The signal that a subject must not be deleted casually, rather than a
   * complaint. Sole coverage is normal and often correct.
   */
  readonly sole: boolean;
}

export interface SubjectValue {
  readonly subject: string;
  readonly components: number;

  /**
   * Components no other subject in the set covers.
   *
   * Empty does **not** mean the subject is redundant — it means every component
   * it contains is watched somewhere else *as a component*, which says nothing
   * about whether this arrangement of them renders correctly. It is the
   * beginning of the question, not the answer.
   */
  readonly unique: readonly string[];
}

export interface Coverage {
  /** Sorted by how many subjects cover each, widest first, then by name. */
  readonly components: readonly ComponentCoverage[];
  /** In the order the subjects were supplied. */
  readonly subjects: readonly SubjectValue[];
}

export function coverageOf(subjects: readonly SubjectCoverage[]): Coverage {
  const byComponent = new Map<string, { subjects: string[]; instances: number }>();

  for (const subject of subjects) {
    // A subject that names the same component twice would otherwise inflate its
    // own coverage count. Boundaries are already folded per component upstream,
    // but this function is public and takes whatever it is handed.
    const seen = new Set<string>();

    for (const hash of subject.components) {
      const entry = byComponent.get(hash.component) ?? { subjects: [], instances: 0 };
      if (!seen.has(hash.component)) {
        entry.subjects.push(subject.subject);
        seen.add(hash.component);
      }
      entry.instances += hash.instances;
      byComponent.set(hash.component, entry);
    }
  }

  const components = [...byComponent.entries()]
    .map(([component, entry]) => ({
      component,
      subjects: entry.subjects,
      instances: entry.instances,
      sole: entry.subjects.length === 1,
    }))
    .sort((a, b) => b.subjects.length - a.subjects.length || a.component.localeCompare(b.component));

  const soleOwner = new Map<string, string>();
  for (const component of components) {
    if (component.sole) soleOwner.set(component.component, component.subjects[0]!);
  }

  return {
    components,
    subjects: subjects.map((subject) => {
      const names = [...new Set(subject.components.map((hash) => hash.component))];
      return {
        subject: subject.subject,
        components: names.length,
        unique: names.filter((name) => soleOwner.get(name) === subject.subject),
      };
    }),
  };
}

/** Subjects that would still watch this component if one of them were removed. */
export function alsoCovering(
  coverage: Coverage,
  component: string,
  excluding: string,
): readonly string[] {
  const entry = coverage.components.find((candidate) => candidate.component === component);
  return entry === undefined ? [] : entry.subjects.filter((subject) => subject !== excluding);
}

/**
 * The overlap as something a person reads before deciding.
 *
 * Leads with sole coverage rather than with the widest components, because the
 * widest components are the ones a reader already knows about — they are in
 * every screenshot — while a component watched by exactly one subject is the fact
 * nobody has.
 */
export function summarizeCoverage(
  coverage: Coverage,
  options: { readonly limit?: number } = {},
): string {
  const limit = options.limit ?? 10;

  if (coverage.components.length === 0) return 'no components covered';

  const sole = coverage.components.filter((component) => component.sole);
  const broad = coverage.components.filter((component) => component.subjects.length > 1);
  const deletable = coverage.subjects.filter((subject) => subject.unique.length === 0);

  const lines = [
    `${coverage.components.length} component(s) across ${coverage.subjects.length} subject(s)`,
    '',
    `${sole.length} component(s) covered by exactly one subject:`,
    ...sole.slice(0, limit).map((c) => `  ${c.component} — only in ${c.subjects[0]}`),
    ...(sole.length > limit ? [`  +${sole.length - limit} more not listed`] : []),
  ];

  if (broad.length > 0) {
    lines.push(
      '',
      `${broad.length} component(s) covered by more than one subject, widest first:`,
      ...broad
        .slice(0, limit)
        .map((c) => `  ${c.component} — ${c.subjects.length} subject(s), ${c.instances} instance(s)`),
      ...(broad.length > limit ? [`  +${broad.length - limit} more not listed`] : []),
    );
  }

  if (deletable.length > 0) {
    lines.push(
      '',
      `${deletable.length} subject(s) cover no component alone: ` +
        deletable
          .slice(0, limit)
          .map((s) => s.subject)
          .join(', ') +
        (deletable.length > limit ? `, +${deletable.length - limit} more` : ''),
      'That is not a recommendation to delete them. A component can render correctly',
      'in one context and wrongly in another, which is why the contexts are separate',
      'subjects in the first place.',
    );
  }

  return lines.join('\n');
}
