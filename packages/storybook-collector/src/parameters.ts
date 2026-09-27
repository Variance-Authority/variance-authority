import type { Viewport } from '@variance-authority/core/format';
import { widthsOf } from '@variance-authority/playwright';
import { declarationOf, PARAMETERS_KEY, type ParametersRead } from '@variance-authority/storybook';
import type { Plan, PlannedSubject } from './contract.js';

/**
 * The story a subject id names.
 *
 * Storybook replaces every character outside `[a-z0-9-]` when it makes an id,
 * so an `@` in a subject id is always the width suffix `widthsOf` added.
 */
export function storyIdOf(subjectId: string): string {
  const id = subjectId.replace(/^story:/, '');
  const at = id.indexOf('@');
  return at === -1 ? id : id.slice(0, at);
}

/**
 * A story's own parameters, laid over the plan the index produced.
 *
 * The index plans every story once at the run's viewport, because tags are all
 * it carries. `read` is what the running preview says each story declared, and
 * it decides which stories are read, at what size and at how many widths. An
 * exclusion lands in `notObserved` with its reason, so a story that asked not to
 * be read is still in the report.
 */
export function withParameters(plan: Plan, read: ParametersRead, run: Viewport): Plan {
  if ('unread' in read) {
    return {
      ...plan,
      warnings: [
        ...plan.warnings,
        `story parameters were not read — ${read.unread}. Every story is read at the run's ` +
          `viewport, and no story's \`parameters.${PARAMETERS_KEY}\` applies to this run`,
      ],
    };
  }

  const subjects: PlannedSubject[] = [];
  const notObserved: unknown[] = [...plan.notObserved];

  for (const planned of plan.subjects) {
    const raw = read.parameters[storyIdOf(planned.subject.id)];
    if (raw === undefined) {
      subjects.push(planned);
      continue;
    }

    const declared = declarationOf(raw, run);
    if ('excluded' in declared) {
      notObserved.push({ subject: planned.subject.id, kind: 'excluded', because: declared.excluded });
      continue;
    }

    // The widths are laid over the story's own viewport, not the run's: a story
    // that declares a dark, 2x viewport and three widths is read dark and 2x at
    // each of them. `widthsOf` keeps a subject that already has a viewport, so
    // the declared one is handed in as the base rather than set on the subject.
    const base = declared.viewport ?? run;
    subjects.push(
      ...(declared.widths === undefined || declared.widths.length === 0
        ? [declared.viewport === undefined ? planned : { ...planned, viewport: declared.viewport }]
        : widthsOf({ subjects: [planned] }, declared.widths, base).subjects),
    );
  }

  return { ...plan, subjects, notObserved };
}
