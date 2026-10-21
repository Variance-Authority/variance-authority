import type { CommentLimits } from './comment.js';
import type { Docket, UnstableEntry } from './docket.js';
import { code, count } from './comment-text.js';

/**
 * The subjects that disagreed with themselves, above the fold.
 *
 * Above it because each one holds the check red and no review settles it: its
 * verdict came from whichever of two readings was taken first, so the next run
 * may take the other, and `accept` refuses it rather than promote a coin flip.
 * What a person can do is make it read the same way twice or exclude it, and
 * both start from what differed between the readings, which is what each line
 * names.
 */
export function unstableBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
  if (docket.unstable.length === 0) return [];

  const shown = docket.unstable.slice(0, limits.causes);
  const hidden = docket.unstable.length - shown.length;

  return [
    '### Unstable',
    [
      `${count(docket.unstable.length, 'subject')} read twice in a row, with nothing changed ` +
        'between, and the two readings disagreed. Neither a change nor a pass, and `accept` ' +
        'refuses it: make it read the same way twice, or exclude it.',
      ...shown.map(unstableItem),
      ...(hidden === 0 ? [] : [`- ${hidden} more in the run report.`]),
    ].join('\n'),
  ];
}

function unstableItem(entry: UnstableEntry): string {
  const named = entry.components
    .map((component) => (component.file === undefined ? code(component.name) : `${code(component.name)} ${code(component.file)}`))
    .join(', ');
  const where = named === '' ? '' : ` — ${named}`;
  const bands = entry.bands.length === 0 ? '' : ` (${entry.bands.join(', ')})`;
  return (
    `- ${code(entry.subject)}${where}${bands}\n` +
    `    ${code(`variance run --subjects '${entry.subject}' --flakes`)}`
  );
}
