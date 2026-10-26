import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT } from './markdown.js';

/**
 * A contract in a `REVIEW.md` that is pinned by a test names the test by its
 * title: `[file.test.ts](src/file.test.ts) › "title"`. The title is a second
 * copy of a string the test file owns, so a renamed test would leave the review
 * contract pointing at nothing while every link still resolves. This check
 * holds each quoted title to a case or group the file its link names declares
 * and runs; the links themselves are `docs-links.check.ts`'s.
 */

const REVIEWS = MARKDOWN.filter((file) => file === 'REVIEW.md' || file.endsWith('/REVIEW.md'));

// A link, the `›` that says what follows is a test title, then one or more
// quoted titles joined by commas, `and` or `or`. A quote inside a title is
// escaped, `\"`, as Markdown renders it. Line breaks are folded first, because a
// title wraps like any other prose.
const QUOTED = String.raw`"(?:[^"\\]|\\.)+"`;
const TITLE = new RegExp(QUOTED, 'g');
const PINNED = new RegExp(
  String.raw`\[[^\]]+\]\(([^)#\s]+)\)\s*›\s*((?:${QUOTED}(?:,|\s+and|\s+or)?\s*)+)`,
  'g',
);

/** What stands in for a pin once it is read, so a quote right after one shows. */
const READ = '\u0000';

/** A quote after a read pin and an interruption: a title the pin pattern stopped short of. */
const RESUMED = new RegExp(String.raw`${READ}\s*(?:\([^)]*\)\s*)?(?:(?:,|and|or)\s*)?"`);

const TEST_FILE = /\.(?:test|spec|measure)\.[cm]?[jt]sx?$/;

const DECLARERS = new Set(['it', 'test', 'describe']);
const NOT_RUN = new Set(['skip', 'todo']);

type Node = Record<string, unknown> & { readonly type: string };

function walk(node: unknown, visit: (node: Node) => void): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record['type'] === 'string') visit(record as Node);
  for (const value of Object.values(record)) walk(value, visit);
}

/** Whether a callee declares a case or group that runs: `it`, `describe.only`, `test.each(...)`, never `.skip` or `.todo`. */
function declaresRun(callee: Node): boolean {
  if (callee.type === 'Identifier') return DECLARERS.has(String(callee['name']));
  if (callee.type === 'CallExpression') return declaresRun(callee['callee'] as Node);
  if (callee.type === 'MemberExpression') {
    const property = callee['property'] as Node;
    if (property.type === 'Identifier' && NOT_RUN.has(String(property['name']))) return false;
    return declaresRun(callee['object'] as Node);
  }
  return false;
}

/** A title written as one string: a literal, or a template with nothing interpolated. */
function spelled(argument: Node | undefined): string | undefined {
  if (argument?.type === 'Literal' && typeof argument['value'] === 'string') return argument['value'];
  if (argument?.type !== 'TemplateLiteral' || (argument['expressions'] as unknown[]).length > 0) return undefined;
  const [quasi] = argument['quasis'] as Node[];
  return (quasi?.['value'] as { cooked?: string } | undefined)?.cooked ?? undefined;
}

/** The strings a `.each` table hands its template, row by row: a row is an array, or one value. */
function rows(callee: Node): readonly (readonly (string | undefined)[])[] {
  if (callee.type !== 'CallExpression') return [];
  const table = (callee['arguments'] as Node[])[0];
  if (table?.type !== 'ArrayExpression') return [];
  return (table['elements'] as Node[]).map((row) =>
    row?.type === 'ArrayExpression' ? (row['elements'] as Node[]).map(spelled) : [spelled(row)],
  );
}

/** The case names a `.each` reports, as Vitest formats them: each `%s` takes the row's next value. */
function expanded(template: string, callee: Node): readonly string[] {
  if (!template.includes('%')) return [];
  return rows(callee).flatMap((row) => {
    let next = 0;
    let whole = true;
    const name = template.replace(/%s/g, () => {
      const value = row[next++];
      if (value === undefined) whole = false;
      return value ?? '';
    });
    return whole && !/%[a-z#%]/i.test(name) ? [name] : [];
  });
}

/** The titles of the cases and groups a test file declares and runs, a `.each` template and the names it reports. */
function titles(file: string): ReadonlySet<string> {
  const { program, errors } = parseSync(file, readFileSync(file, 'utf8'));
  // A file this rule cannot read is a file whose titles it cannot vouch for.
  if (errors.length > 0) throw new Error(`${file} could not be parsed: ${errors[0]!.message}`);
  const found = new Set<string>();
  walk(program, (node) => {
    if (node.type !== 'CallExpression' || !declaresRun(node['callee'] as Node)) return;
    const title = spelled((node['arguments'] as Node[])[0]);
    if (title === undefined) return;
    found.add(title);
    for (const name of expanded(title, node['callee'] as Node)) found.add(name);
  });
  return found;
}

interface Pin {
  readonly review: string;
  readonly test: string;
  readonly title: string;
}

function text(review: string): string {
  return readFileSync(join(ROOT, review), 'utf8').replace(/\s+/g, ' ');
}

function pinsIn(review: string): readonly Pin[] {
  return [...text(review).matchAll(PINNED)].flatMap((match) =>
    [...match[2].matchAll(TITLE)].map((title) => ({
      review,
      test: join(dirname(review), match[1]),
      title: title[0].slice(1, -1).replace(/\\(.)/g, '$1'),
    })),
  );
}

/** What in a review's prose the pins leave unread: a `›` outside link text and code, or a title past an interruption. */
function unread(review: string): readonly string[] {
  const rest = text(review).replace(PINNED, READ);
  const problems: string[] = [];
  if (RESUMED.test(rest)) problems.push('a quoted title after an interruption no pin reads');
  const prose = rest.replace(/`[^`]*`/g, '').replace(/\[[^\]]*\]/g, '');
  for (const arrow of prose.matchAll(/›.{0,40}/g)) problems.push(`no pin reads "${arrow[0]}"`);
  return problems;
}

describe('a test title a REVIEW.md quotes', () => {
  const pins = REVIEWS.flatMap(pinsIn);

  it('is found in the cascade at all', () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it('follows a link to the test file that declares it', () => {
    const loose = REVIEWS.flatMap((review) => unread(review).map((problem) => `  ${review}: ${problem}`));
    expect(loose.join('\n')).toBe('');
  });

  it('names a test file', () => {
    const named = pins
      .filter((pin) => !TEST_FILE.test(pin.test) || !existsSync(join(ROOT, pin.test)))
      .map((pin) => `  ${pin.review}: ${pin.test} is not a test file`);
    expect([...new Set(named)].join('\n')).toBe('');
  });

  it('is the title of a case or group that runs in that file', () => {
    const read = new Map<string, ReadonlySet<string>>();
    const missing = pins
      .filter((pin) => TEST_FILE.test(pin.test) && existsSync(join(ROOT, pin.test)))
      .filter((pin) => {
        if (!read.has(pin.test)) read.set(pin.test, titles(join(ROOT, pin.test)));
        return !read.get(pin.test)!.has(pin.title);
      })
      .map((pin) => `  ${pin.review}: "${pin.title}" is not a title in ${pin.test}`);
    expect(missing.join('\n')).toBe('');
  });
});
