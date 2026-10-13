// compass: variance-authority.retention

import type { BaselineKey } from './store.js';

/**
 * The key a test's observation is stored under: its subject, the file the test
 * is declared in, and the titles it was declared under.
 *
 * `titles` run outermost first — the `describe` blocks, then the test's own —
 * and are given apart rather than read back from the subject id, because a
 * runner joins them with a separator a title may contain. The last is the
 * baseline's `name` and the rest its `title`, which is all a template needs to
 * write a path a reviewer reads as *this test*.
 *
 * The file and the titles decide only where the baseline is filed. The subject
 * decides which baseline it is.
 */
export function testBaselineKey(
  subject: string,
  declared: { readonly file?: string; readonly titles?: readonly string[] } = {},
): BaselineKey {
  const { file, titles } = declared;
  return {
    subject,
    ...(file === undefined ? {} : { file }),
    ...(titles === undefined || titles.length === 0
      ? {}
      : {
          ...(titles.length > 1 ? { title: titles.slice(0, -1).join('/') } : {}),
          name: titles.at(-1)!,
        }),
  };
}
