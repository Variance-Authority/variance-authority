import type { CliRunReport } from './run.js';

/**
 * A subject's before and after, as two images a pull-request comment can show.
 *
 * Separate from `comment-blocks.ts` because it is the one part of the comment
 * that points outside the body: the bytes live wherever the operator published
 * the report's `images/` directory, and this file only spells the address. The
 * paths are the report's own, carried as written and joined to `--image-root`,
 * so the published layout and the report can never disagree about a file name.
 *
 * Before and after rather than the diff, because the pair is what a reviewer
 * approves; the diff is how the report finds the region, and the cause line
 * above the pictures already names it.
 */
export type Pictures = (subject: string) => string | undefined;

/** A lookup that answers nothing when no image root was given, so every caller can ask unconditionally. */
export function picturesOf(report: CliRunReport, imageRoot: string | undefined): Pictures {
  if (imageRoot === undefined) return () => undefined;
  const root = imageRoot.replace(/\/+$/, '');
  const bySubject = new Map(report.observations.map((entry) => [entry.subject, entry.images]));

  return (subject) => {
    const images = bySubject.get(subject);
    if (images?.before === undefined || images.after === undefined) return undefined;
    return [
      image(root, images.before, `${subject} before`),
      image(root, images.after, `${subject} after`),
    ].join(' ');
  };
}

/**
 * One `<img>`, sized so two sit side by side on a phone.
 *
 * Each segment is percent-encoded, because the store already percent-encodes a
 * subject id into its file name: `story%3Abutton.before.png` is the name on disk,
 * and a URL that carried the `%3A` raw would ask the server for `story:button`.
 * The subject id reaches the `alt` text from the collector, so it is escaped.
 */
function image(root: string, path: string, alt: string): string {
  const src = `${root}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return `<img src="${attribute(src)}" alt="${attribute(alt)}" width="48%">`;
}

function attribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
