import type { Viewport } from '@variance-authority/core/format';

/**
 * What a subject can ask of a page that is already open, and what it cannot.
 *
 * Here rather than in either collector because it is a fact about a **browser
 * context**, not about routes or stories: width and height are a resize, and a
 * device scale factor or a colour scheme is decided when the context is created.
 * Both collectors have to refuse the second kind in the same words, because the
 * failure they are refusing is the same one — a subject painted at the run's
 * viewport while recording its own produces a baseline whose environment key
 * describes a render that never happened, and every verdict over it is green.
 */

/**
 * Why this subject cannot be read in the page the run opened, or `undefined`.
 *
 * Width and height are a resize. A device scale factor or a colour scheme is a
 * property of the browser *context*, decided when it was created, and a run that
 * quietly painted at the wrong one while recording the requested value would
 * produce a baseline whose key describes a render that never happened.
 */
export function unresizable(wanted: Viewport, run: Viewport): string | undefined {
  if (wanted.deviceScaleFactor !== run.deviceScaleFactor) {
    return (
      `this subject asks for deviceScaleFactor ${wanted.deviceScaleFactor} and the run opened ` +
      `its browser at ${run.deviceScaleFactor}. A scale factor is fixed when the browser ` +
      'context is created, so it cannot be changed per subject — run it as its own run rather ' +
      'than recording a key for a render that did not happen'
    );
  }

  if (wanted.colorScheme !== run.colorScheme) {
    return (
      `this subject asks for the ${wanted.colorScheme} colour scheme and the run opened its ` +
      `browser in ${run.colorScheme}. A colour scheme is fixed when the browser context is ` +
      'created, so it cannot be changed per subject'
    );
  }

  return undefined;
}

/** The part of a planned subject a width list reads and rewrites. */
export interface WidthPlanned {
  readonly subject: { readonly id: string };
  readonly viewport?: Viewport;
}

/**
 * The plan, once per declared width.
 *
 * Beside `unresizable` because it is the other half of the same fact: a width is
 * a resize, so one open page can read a subject at every width a run declares,
 * and each width is its own subject — its own baseline, its own verdict, its own
 * place in the report. Reading one page at three widths and calling it one result
 * would hide two of the three answers behind whichever failed first.
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
export function widthsOf<S extends WidthPlanned, P extends { readonly subjects: readonly S[] }>(
  plan: P,
  widths: readonly number[] | undefined,
  viewport: Viewport,
): P {
  if (widths === undefined || widths.length === 0) return plan;

  const distinct = [...new Set(widths)].sort((left, right) => left - right);

  return {
    ...plan,
    subjects: plan.subjects.flatMap((planned): S[] =>
      planned.viewport !== undefined
        ? [planned]
        : distinct.map(
            (width) =>
              ({
                ...planned,
                subject: { ...planned.subject, id: `${planned.subject.id}@${width}` },
                viewport: { ...viewport, width },
              }) as S,
          ),
    ),
  };
}

/**
 * The id a widened subject was planned under.
 *
 * Only strips a suffix `widthsOf` could have added. A project whose own subject
 * ids contain an `@` — `page@2x`, an email route — keeps them, because the suffix
 * is matched against the declared width list rather than against any trailing
 * number.
 */
export function unwidened(id: string, widths: readonly number[] | undefined): string {
  if (widths === undefined) return id;

  const at = id.lastIndexOf('@');
  if (at === -1) return id;

  const suffix = Number(id.slice(at + 1));
  return widths.includes(suffix) ? id.slice(0, at) : id;
}
