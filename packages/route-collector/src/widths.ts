import type { Viewport } from '@variance-authority/core';
import type { Plan } from './index.js';

/**
 * What a declared width list does to a plan, and what it cannot do to a browser.
 *
 * Its own file because none of it touches a page: each function takes values and
 * returns values, which is what makes the claims testable without a browser — and
 * the claims are the sort that are invisible when they go wrong. A plan expanded
 * with the wrong ids orphans every baseline a suite has; a subject painted at the
 * run's viewport while recording its own produces green results for a render that
 * never happened.
 */

/**
 * The plan, once per declared width.
 *
 * Returned unchanged when no widths are declared, which is the ordinary case and
 * has to stay byte-identical: a suite that adds and then removes `widths` must
 * get its original subject ids back, or every baseline it has is orphaned.
 *
 * A subject that already declares its own viewport keeps it. Per-subject beats
 * per-run everywhere else in this system, and a width list is a run-level default
 * — overriding a subject's own declaration with one would be the config quietly
 * winning an argument the subject already had.
 */
export function widthsOf(plan: Plan, widths: readonly number[] | undefined, viewport: Viewport): Plan {
  if (widths === undefined || widths.length === 0) return plan;

  const distinct = [...new Set(widths)].sort((left, right) => left - right);

  return {
    ...plan,
    subjects: plan.subjects.flatMap((planned) =>
      planned.viewport !== undefined
        ? [planned]
        : distinct.map((width) => ({
            ...planned,
            subject: { ...planned.subject, id: `${planned.subject.id}@${width}` },
            viewport: { ...viewport, width },
          })),
    ),
  };
}

/**
 * The route a widened subject id belongs to.
 *
 * Only strips a suffix this collector could have added. A project whose own
 * subject ids contain an `@` — `page@2x`, an email route — keeps them, because
 * the suffix is matched against the declared width list rather than against any
 * trailing number.
 */
export function routeOf(id: string, widths: readonly number[] | undefined): string {
  if (widths === undefined) return id;

  const at = id.lastIndexOf('@');
  if (at === -1) return id;

  const suffix = Number(id.slice(at + 1));
  return widths.includes(suffix) ? id.slice(0, at) : id;
}
