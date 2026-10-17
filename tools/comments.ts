import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './markdown.js';
import { MODULES } from './modules.js';

/**
 * Where else documentation is written: source, CI workflows, shell scripts.
 *
 * Close to the list `tools/unrun.mjs` scans for markers, and for its reason — a
 * comment is a comment whether it opens with `//` or `#`, and CI and the
 * container harness are where the stalest ones sit, because nobody rereads a
 * workflow the way they reread a page. Wider by the `Dockerfile`, which carries
 * comments about this tree and no markers. The modules come from the shared
 * list, so an extension added there is read here too.
 *
 * Not that file's own `tracked()`, which drops `tools/unrun.mjs` and
 * `tools/unrun.check.ts` so their spelled-out markers do not register as
 * markers. Both are full of paths, and skipping them would be a hole in every
 * rule that reads comments rather than a feature of one.
 */
export const SOURCE: readonly string[] = [
  ...MODULES,
  ...execFileSync('git', ['ls-files', '*.sh', '*.yml', '*.yaml', '*Dockerfile'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => existsSync(join(ROOT, file))),
];

/** Files whose comments open with `#` and run to the end of the line. */
const HASH = /(?:\.(?:sh|ya?ml)|Dockerfile)$/;

/**
 * One file with everything that is not a comment blanked out.
 *
 * The inverse of `prose()`, which blanks markdown's fences so a prose rule
 * cannot read an example. Spaces rather than deletion, so `lineOf` still counts
 * the lines the file actually has and a failure names the line an editor opens.
 *
 * String literals are stepped over, because `'https://…'` carries a `//` and a
 * scanner that opened a comment there would read the rest of a line of code as
 * prose. A regex literal holding a lone quote can still confuse that; what it
 * costs is a comment left unread, never a path invented.
 */
export function commentsOf(file: string): string {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const kept = Array.from(text, (char) => (char === '\n' ? '\n' : ' '));
  const keep = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) kept[at] = text[at]!;
  };

  if (HASH.test(file)) {
    let at = 0;
    for (const line of text.split('\n')) {
      if (/^[ \t]*#/.test(line)) keep(at, at + line.length);
      at += line.length + 1;
    }
    return kept.join('');
  }

  for (let at = 0; at < text.length; at += 1) {
    const opener = text.slice(at, at + 2);
    const quote = text[at]!;

    if (opener === '//' || opener === '/*') {
      const end = opener === '//' ? text.indexOf('\n', at) : text.indexOf('*/', at + 2);
      const stop = end === -1 ? text.length : opener === '//' ? end : end + 2;
      keep(at, stop);
      at = stop - 1;
    } else if (quote === "'" || quote === '"' || quote === '`') {
      at += 1;
      while (at < text.length && text[at] !== quote) at += text[at] === '\\' ? 2 : 1;
    }
  }
  return kept.join('');
}
