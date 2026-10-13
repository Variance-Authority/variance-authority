/**
 * A CSS `url()` token: the double-quoted, single-quoted or bare form, captured in
 * that order.
 *
 * One pattern for every reader of a url in this package, because a computed
 * value and a face's `src` are the same grammar, and two copies of it are two
 * answers to which file a declaration names.
 */
export const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;

/**
 * The URLs inside a style value.
 *
 * Computed values are normalized by the engine, so quoting is predictable — but
 * only in a real engine. Under jsdom a declared value comes back as written,
 * which is why both quoted forms and the bare one are handled: the same function
 * has to work in the cheap tier, where most of this project's tests run.
 */
export function urlsIn(value: string): readonly string[] {
  if (value === '' || !value.includes('url(')) return [];

  const urls: string[] = [];
  for (const match of value.matchAll(URL_TOKEN)) {
    const url = match[1] ?? match[2] ?? match[3] ?? '';
    if (url !== '') urls.push(url);
  }

  return urls;
}
