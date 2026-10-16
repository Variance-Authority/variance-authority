import type { CliRunReport } from './run.js';
import { urlOfPath } from './url-of-path.js';

/**
 * A subject's change, as the picture a pull-request comment can show.
 *
 * Separate from `comment-blocks.ts` because it is the one part of the comment
 * that points outside the body: the bytes live wherever the operator published
 * the report's `images/` directory, and this file only spells the address. The
 * paths are the report's own, carried as written and joined to `--image-root`,
 * so the published layout and the report can never disagree about a file name.
 *
 * The change rather than the pages. A full-page capture shown whole is scaled to
 * the comment's column and its text cannot be read, so the picture is the run's
 * crop of it: each of the largest regions with the rows around it, before
 * beside after with the change marked on both, at its own size. It is one
 * `<img>` where the pages were two, so it costs the comment less text, not more. A subject the run cut
 * no crop for, because no region was isolated, shows its before and after.
 */
export type Pictures = (subject: string) => string | undefined;

/** A lookup that answers nothing when no image root was given, so every caller can ask unconditionally. */
export function picturesOf(report: CliRunReport, imageRoot: string | undefined): Pictures {
  if (imageRoot === undefined) return () => undefined;
  const root = imageRoot.replace(/\/+$/, '');
  const bySubject = new Map(report.observations.map((entry) => [entry.subject, entry.images]));

  return (subject) => {
    const images = bySubject.get(subject);
    if (images?.change !== undefined) {
      return image(root, images.change, `${subject}: before beside after, the change marked`);
    }
    if (images?.before === undefined || images.after === undefined) return undefined;
    // Two side by side, sized so they still fit a phone's column.
    return [
      image(root, images.before, `${subject} before`, ' width="48%"'),
      image(root, images.after, `${subject} after`, ' width="48%"'),
    ].join(' ');
  };
}

/**
 * One `<img>`, its path joined to the root as a URL by {@link urlOfPath}.
 *
 * The subject id reaches the `alt` text from the collector, so it is escaped.
 */
function image(root: string, path: string, alt: string, size = ''): string {
  const src = `${root}/${urlOfPath(path)}`;
  return `<img src="${attribute(src)}" alt="${attribute(alt)}"${size}>`;
}

function attribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
