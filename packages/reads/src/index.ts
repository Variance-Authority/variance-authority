/**
 * Say, on the element that shows it, which files a page showed.
 *
 * A page that renders a document read at build time, a string bundled with
 * `?raw`, or a body a cache answered ran no code that names the file, so the
 * code a page ran cannot say the page depends on it. The element that shows it
 * can. A recorded page run reads this attribute inside the subject's root and
 * keeps each file as something the page showed, so an edit to one photographs
 * the pages that show it.
 *
 * Production code: no dependencies, no runtime, no side effect. It returns
 * props to spread, in any framework that spreads them.
 */

/** The attribute a recorded page run reads: repository paths, space-separated. */
export const READS_ATTRIBUTE = 'data-variance-reads';

/** Props naming what an element showed, or none when it was handed nothing. */
export type ReadsProps = { readonly [READS_ATTRIBUTE]?: string };

type Named = string | undefined;

/**
 * Props that say this element showed `paths`: repository-relative, as `git`
 * names them, the same file however many times it is named.
 *
 * ```tsx
 * <article {...reads(document.path)}>{document.body}</article>
 * ```
 *
 * An `undefined` is skipped, so a lookup that found nothing names nothing. A
 * path the attribute cannot carry — empty, or holding whitespace — throws,
 * because it would come back as files nobody showed.
 */
export function reads(...paths: readonly (Named | readonly Named[])[]): ReadsProps {
  const named = new Set<string>();
  for (const path of paths.flat()) {
    if (path === undefined) continue;
    if (path === '') throw new TypeError('reads(): a path is empty');
    if (/\s/.test(path)) {
      throw new TypeError(`reads(): \`${path}\` holds whitespace, and the attribute is space-separated`);
    }
    named.add(path);
  }
  if (named.size === 0) return {};
  // Code-unit order, so the same files are the same markup on every machine.
  return { [READS_ATTRIBUTE]: [...named].sort().join(' ') };
}
