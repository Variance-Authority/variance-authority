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
 * These four rules cover the names that are *addresses* — a link, a path, a
 * `file:line` — and every one of them is `existsSync` and a regex. Nothing here
 * parses TypeScript, and nothing here should ever need to.
 *
 * Two corpora, one standard. A comment is documentation that happens to sit at
 * the line it explains; it names paths for the same reason a page does and loses
 * them to the same renames. Holding only markdown to this was never a decision —
 * it was `git ls-files '*.md'` being the whole of the corpus — and the
 * `tools/*.test.ts` rename left eight dangling paths on the other side of it, in
 * workflows, shell scripts and docblocks, while the same commands quoted in
 * `docs/context/journal/0002-fiber-provenance.md` stayed right because those
 * were checked. Seven came out of a hand audit. The eighth is the argument: a
 * hand audit is the mechanism this file exists to replace.
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
  'cart.spec.ts': "a reader's own spec file, quoted from a transcript about it",
  'tests/checkout.spec.ts': "a reader's own spec file, quoted from a watcher transcript",
  'tests/cart.spec.ts': "a reader's own spec file, quoted from a watcher transcript",
  'src/checkout/CartSummary.tsx': "a reader's own component, quoted from a sample report",
  'src/ds.tsx': "a reader's own design-system module, quoted from a sample answer",
  'packages/core/dist/hash.js': 'a build artifact named in a quoted bundler error',
  'src/todo/TodoFooter.tsx': "a reader's own component, quoted from a sample answer",
  'src/ds/ChipGroup.tsx': "a reader's own component, quoted from a sample answer",
  'src/dispatch/CarrierPicker.tsx': "a reader's own component, quoted from a sample answer",
  'src/dispatch/PickupWindow.tsx': "a reader's own component, quoted from a sample answer",
  'src/checkout/Stack.tsx': "a reader's own component, quoted from a sample answer",
  'src/app/cart.tsx': "a reader's own component, quoted from a sample answer",
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
    // A fenced block is shown, not followed: a sample of generated markdown
    // carries the links of the artifact it depicts, not of this document.
    const text = prose(file);
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
 * Pages published as product documentation, rather than repository context for
 * contributors and maintainers.
 */
const PUBLIC_MARKDOWN = MARKDOWN.filter(
  (file) =>
    (file === 'README.md' ||
      /^docs\/[^/]+\.md$/.test(file) ||
      /^(?:packages|examples|cases)\/[^/]+\/README\.md$/.test(file)) &&
    file !== 'docs/AGENTS.md' &&
    file !== 'docs/visual-guidelines.md',
);

describe('public documentation stands without internal project history', () => {
  it.each(PUBLIC_MARKDOWN)('%s', (file) => {
    const text = prose(file);
    const internal: string[] = [];

    for (const match of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[2]!;
      if (/^(https?:|mailto:)/.test(target)) continue;

      const [path] = target.split('#') as [string];
      const resolved = path === '' ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), path);
      const inside = relative(ROOT, resolved);
      if (inside.startsWith('docs/context/') || inside.startsWith('docs/specs/')) {
        internal.push(`${file}:${lineOf(text, match.index)} → ${target}`);
      }
    }

    for (const match of text.matchAll(/\b(?:ADR-\d{4}|(?:journal|spec)\s+\d{4})\b/gi)) {
      internal.push(`${file}:${lineOf(text, match.index)} → ${match[0]}`);
    }

    for (const match of text.matchAll(
      /\b(?:docs\/(?:context|specs)|context\/(?:adr|journal)|context\/checkpoint\.md|specs\/\d{4}-[\w-]+\.md)(?:\/[\w./-]+)?/gi,
    )) {
      internal.push(`${file}:${lineOf(text, match.index)} → ${match[0]}`);
    }

    expect(internal).toEqual([]);
  });
});

interface Claim {
  readonly path: string;
  /** Line of the opening backtick, 1-based, in the text the claim was read from. */
  readonly line: number;
}

/**
 * A path in backticks is a claim that the file is there.
 *
 * Only paths under this repository's own directories: `variance.config.json` and
 * `storybook-static/index.json` are things a *reader* has, and a checker that
 * demanded they exist here would be checking the wrong repository.
 *
 * The backticks are the discrimination, not decoration, and this is the one
 * place that spells it — both corpora below call this rather than each growing
 * a regex that drifts from the other. Matching bare repository-shaped tokens
 * instead finds `tools/call` and `tools/list`, which are JSON-RPC method names
 * in `packages/mcp`; a `packages/oxc` that is a sentence about a parser and
 * never was a directory; and half a dozen real paths with a full stop welded on
 * by the sentence they end. Inside backticks, every match is an address
 * somebody meant.
 */
function pathsIn(text: string): readonly Claim[] {
  const found: Claim[] = [];

  for (const match of text.matchAll(/`([\w./@-]+\.\w{1,5})(?::\d+)?`/g)) {
    const path = match[1]!;
    if (!REPO_DIRS.some((dir) => path.startsWith(dir))) continue;
    if (path in FOREIGN) continue;
    found.push({ path, line: lineOf(text, match.index) });
  }
  return found;
}

/** The claims that name nothing, as `file:line → path`. */
function unresolved(file: string, claimed: readonly Claim[]): string[] {
  return claimed
    .filter((claim) => !existsSync(join(ROOT, claim.path)))
    .map((claim) => `${file}:${claim.line} → ${claim.path}`);
}

describe('every path named in prose exists', () => {
  it.each(MARKDOWN)('%s', (file) => {
    expect(unresolved(file, pathsIn(prose(file)))).toEqual([]);
  });
});

/**
 * Where else a path gets named: source, CI workflows, shell scripts.
 *
 * Close to the list `tools/unrun.mjs` scans for markers, and for its reason — a
 * comment is a comment whether it opens with `//` or `#`, and CI and the
 * container harness are where the stalest ones sit, because nobody rereads a
 * workflow the way they reread a page. Wider by a config's `.mts` and by the
 * `Dockerfile`, which carry comments about this tree and no markers.
 *
 * Not that file's own `tracked()`, which drops `tools/unrun.mjs` and
 * `tools/unrun.check.ts` so their spelled-out markers do not register as
 * markers. Both are full of paths, and skipping them would be a hole in this
 * rule rather than a feature of it.
 */
const SOURCE: readonly string[] = execFileSync(
  'git',
  [
    'ls-files',
    '*.ts',
    '*.tsx',
    '*.mts',
    '*.js',
    '*.jsx',
    '*.mjs',
    '*.cjs',
    '*.sh',
    '*.yml',
    '*.yaml',
    '*Dockerfile',
  ],
  { cwd: ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter((file) => existsSync(join(ROOT, file)));

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
function commentsOf(file: string): string {
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

describe('every path named in a comment exists', () => {
  const CLAIMED = new Map(SOURCE.map((file) => [file, pathsIn(commentsOf(file))] as const));

  it('finds paths to check, so this rule cannot pass by reading nothing', () => {
    // Both halves can go quiet without anything else noticing. A pathspec that
    // stops matching empties the corpus; a comment scanner that stops finding
    // comments empties every file in it. Either way the six hundred assertions
    // below all pass, having read nothing.
    expect(SOURCE.length).toBeGreaterThan(100);
    expect([...CLAIMED.values()].flat().length).toBeGreaterThan(50);
  });

  it.each(SOURCE)('%s', (file) => {
    expect(unresolved(file, CLAIMED.get(file) ?? [])).toEqual([]);
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
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((file) => existsSync(join(ROOT, file))),
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
      /(?:([A-Z][A-Za-z0-9_]*)\s+)?`?([\w./-]+\.(?:[cm]?tsx?|[cm]?jsx?))`?:(\d+)/g,
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
