import type { Viewport } from '@variance-authority/core/format';
import { widthsOf } from '@variance-authority/playwright';
import { declarationOf, PARAMETERS_KEY, type ParametersRead } from '@variance-authority/storybook';
import type { PlannedSubject } from './contract.js';

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

/** What one story's parameters make of the subject the run asked for. */
export type Realized =
  | { readonly excluded: string }
  | { readonly refused: string }
  | {
      readonly subjects: readonly PlannedSubject[];
      readonly warning?: string;
      /** Present when the parameters were not read, so the widths the story declares are unknown. */
      readonly incomplete?: true;
    };

/**
 * The subjects a story becomes once its own parameters are known.
 *
 * The plan holds every story once, from the index, because the index carries no
 * parameters. Reaching the story is what reads them, and they decide whether it
 * is read at all, at what size, and at how many widths: each width is a subject
 * of its own, with the id and the name `widthsOf` gives it, so a baseline stays
 * where it was.
 *
 * `planned` is the story as the plan has it, or one width of it as an earlier
 * reading of this run produced it — read again to settle a change. That one
 * comes back alone, at the width the story declares now; a width the story no
 * longer declares is refused rather than read at a size nothing asked for.
 */
export function realize(planned: PlannedSubject, read: ParametersRead, run: Viewport): Realized {
  const storyId = storyIdOf(planned.subject.id);
  const story = `story:${storyId}`;
  const isStory = planned.subject.id === story;

  // Named for no story: every story of the run gets these words, and the run
  // says a warning once however many visits gave it.
  if ('unsupported' in read) {
    return {
      subjects: [planned],
      incomplete: true,
      warning:
        `story parameters were not read — ${read.unsupported}. Every story is read at the run's ` +
        `viewport, and \`parameters.${PARAMETERS_KEY}\` does not apply to this run`,
    };
  }

  if ('unread' in read) {
    return {
      subjects: [planned],
      incomplete: true,
      warning:
        `the parameters of story \`${storyId}\` were not read — ${read.unread}. It is read at the run's ` +
        `viewport, and its \`parameters.${PARAMETERS_KEY}\` does not apply to this run`,
    };
  }

  const declared = read.parameters === undefined ? {} : declarationOf(read.parameters, run);
  if ('excluded' in declared) return { excluded: declared.excluded };

  const widths = declared.widths ?? [];
  // The widths are laid over the story's own viewport, not the run's: a story
  // that declares a dark, 2x viewport and three widths is read dark and 2x at
  // each of them.
  const base = declared.viewport ?? run;

  if (isStory) {
    if (widths.length > 0) return { subjects: widthsOf({ subjects: [planned] }, widths, base).subjects };
    return { subjects: [declared.viewport === undefined ? planned : { ...planned, viewport: declared.viewport }] };
  }

  const width = widths.find((candidate) => `${story}@${candidate}` === planned.subject.id);
  if (width === undefined) {
    return {
      refused:
        `story \`${storyId}\` no longer declares the width \`${planned.subject.id}\` reads at; it declares ` +
        (widths.length === 0 ? 'none' : [...new Set(widths)].sort((a, b) => a - b).join(', ')),
    };
  }
  return { subjects: [{ ...planned, viewport: { ...base, width } }] };
}
