import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, lineOf, prose } from './markdown.js';

/**
 * Where the documentation points, checked against what is there.
 *
 * Prose does not rot at random. It rots wherever it names something the compiler
 * also names, because the compiler renames things and the prose does not follow.
 * These three rules cover the names that are *addresses* — a link, a path, a
 * `file:line` — and every one of them is `existsSync` and a regex. Nothing here
 * parses TypeScript, and nothing here should ever need to.
 */

/** Top-level directories that make a backticked path a claim about this repository. */
const REPO_DIRS = ['packages/', 'examples/', 'cases/', 'docs/', 'tools/', 'docker/', '.github/'];

/**
 * Paths and references that name something outside this repository.
 *
 * Listed with the reason rather than inferred from a pattern, so that adding one
 * is a decision somebody made rather than a hole that opened.
 */
const FOREIGN: Readonly<Record<string, string>> = {
  'tests/home.spec.ts': "an incumbent's spec file, quoted from its output",
  'packages/core/dist/hash.js': 'a build artifact named in a quoted bundler error',
};


describe('every link resolves', () => {
  const slug = (heading: string): string =>
    heading
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/ /g, '-');

  const headings = (file: string): ReadonlySet<string> => {
    const found = new Set<string>();
    let fenced = false;

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      else if (!fenced) {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading !== null) found.add(slug(heading[1]!));
      }
    }
    return found;
  };

  it.each(MARKDOWN)('%s', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const broken: string[] = [];

    for (const match of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[2]!;
      if (/^(https?:|mailto:)/.test(target)) continue;

      // A bare `#anchor` splits to an empty path, which resolves to this file —
      // so an in-page link is checked against this file's own headings.
      const [path, anchor] = target.split('#') as [string, string | undefined];
      const resolved = path === '' ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), path);

      if (!existsSync(resolved)) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target}`);
        continue;
      }
      if (anchor === undefined) continue;

      const document = statSync(resolved).isDirectory() ? join(resolved, 'README.md') : resolved;
      if (!existsSync(document) || !document.endsWith('.md')) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target} (anchor on a non-document)`);
        continue;
      }
      if (!headings(document).has(anchor)) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target} (no such heading)`);
      }
    }

    expect(broken).toEqual([]);
  });
});

/**
 * A path in backticks is a claim that the file is there.
 *
 * Only paths under this repository's own directories: `variance.config.json` and
 * `storybook-static/index.json` are things a *reader* has, and a checker that
 * demanded they exist here would be checking the wrong repository.
 */
describe('every path named in prose exists', () => {
  it.each(MARKDOWN)('%s', (file) => {
    const text = prose(file);
    const missing: string[] = [];

    for (const match of text.matchAll(/`([\w./@-]+\.\w{1,5})(?::\d+)?`/g)) {
      const path = match[1]!;
      if (!REPO_DIRS.some((dir) => path.startsWith(dir))) continue;
      if (path in FOREIGN) continue;
      if (!existsSync(join(ROOT, path))) missing.push(`${file}:${lineOf(text, match.index)} → ${path}`);
    }

    expect(missing).toEqual([]);
  });
});

/**
 * `Component src/file.tsx:42` is two claims, and the second is the one that rots.
 *
 * The file moves and the line number does not, so the reference keeps resolving
 * and starts landing on something else. Twelve of these were pointing at
 * unrelated source before anybody read one. Where the prose names what is there,
 * the line has to define it.
 */
describe('every file:line reference lands where it says', () => {
  const TRACKED = new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n'),
  );

  /**
   * The file a reference names, resolved the way a reader would resolve it.
   *
   * Relative to the document first, then from the repository root, then by unique
   * suffix — a case's README says `src/surface.tsx` about its own tree, and the
   * index one directory up says the same words about the same file.
   */
  function locate(file: string, path: string): string | null {
    const beside = relative(ROOT, resolve(dirname(join(ROOT, file)), path));
    if (TRACKED.has(beside)) return beside;
    if (TRACKED.has(path)) return path;

    const suffix = [...TRACKED].filter((tracked) => tracked.endsWith(`/${path}`));
    return suffix.length === 1 ? suffix[0]! : null;
  }

  it.each(MARKDOWN)('%s', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const wrong: string[] = [];

    for (const match of text.matchAll(
      /(?:([A-Z][A-Za-z0-9_]*)\s+)?`?([\w./-]+\.(?:tsx?|mjs|cjs|js|jsx))`?:(\d+)/g,
    )) {
      const [, named, path = '', digits = ''] = match;
      if (path in FOREIGN) continue;

      const where = `${file}:${lineOf(text, match.index)}`;
      const target = locate(file, path);
      if (target === null) {
        wrong.push(`${where} → ${path} (no such file)`);
        continue;
      }

      const lines = readFileSync(join(ROOT, target), 'utf8').split('\n');
      const line = Number(digits);
      if (line < 1 || line > lines.length) {
        wrong.push(`${where} → ${target}:${line} (the file has ${lines.length} lines)`);
        continue;
      }

      // Only when the prose names what is there. `at packages/core/src/region.ts:82`
      // claims a place and nothing about it; `Heading src/surface.tsx:153` claims
      // that line 153 is where `Heading` is.
      if (named !== undefined && !new RegExp(`\\b${named}\\b`).test(lines[line - 1]!)) {
        wrong.push(`${where} → ${target}:${line} does not mention ${named}: ${lines[line - 1]!.trim()}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});
