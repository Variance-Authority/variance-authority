import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, IDIOMS, counted, sites, sitesIn, sources } from './owners.mjs';

/**
 * Owned answers, computed again outside their owner (ADR-0069).
 *
 * The idioms are short, so a copy-paste detector misses them. Nobody copies a
 * one-line comparator; each one is typed fresh. The reader finds the shape in
 * the parse tree, and the ratchet holds the count per file. A new site fails
 * and names the owner. A site that moved to its owner fails too, until the
 * baseline is tightened.
 *
 * ```bash
 * yarn owners --write
 * ```
 *
 * The baseline records the file and a count, not the line, so an edit above a
 * site does not churn it.
 */

interface Site {
  readonly idiom: keyof typeof IDIOMS;
  readonly at: string;
  readonly line: number;
  readonly name?: string;
}

interface Row {
  readonly idiom: keyof typeof IDIOMS;
  readonly at: string;
  readonly count: number;
}

const idioms = (file: string, text: string): readonly string[] =>
  (sitesIn(file, text) as readonly Site[]).map((site) => `${site.idiom} ${site.name ?? ''}`.trim());

describe('the owners reader', () => {
  it('finds a SHA-256 digest taken from the platform', () => {
    expect(
      idioms(
        'packages/cli/src/a.ts',
        [
          "import { createHash } from 'node:crypto';",
          "const one = (text: string) => createHash('sha256').update(text).digest('hex');",
          "import * as crypto from 'node:crypto';",
          "export const two = (text: string) => crypto.createHash('sha256').update(text).digest('hex');",
          "export const three = (bytes: Uint8Array) => crypto.subtle.digest('SHA-256', bytes);",
          "export const four = (bytes: Uint8Array) => crypto.subtle.digest({ name: 'SHA-256' }, bytes);",
        ].join('\n'),
      ),
    ).toEqual(['digest one', 'digest two', 'digest three', 'digest four']);
  });

  it('leaves a digest the owner does not compute, such as a Jest cache key or an S3 ETag', () => {
    expect(
      idioms(
        'packages/cli/src/a.ts',
        [
          "import { createHash } from 'node:crypto';",
          "const key = (text: string) => createHash('sha1').update(text).digest('hex');",
          "const etag = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');",
          "const short = (bytes: Uint8Array) => crypto.subtle.digest('SHA-1', bytes);",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('finds a code-unit comparator in either nesting, parenthesised or not', () => {
    expect(
      idioms(
        'packages/cli/src/a.ts',
        [
          'const one = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);',
          'function two(a: string, b: string) { return a > b ? 1 : (a < b ? -1 : 0); }',
          'const three = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);',
        ].join('\n'),
      ),
    ).toEqual(['code-unit-order one', 'code-unit-order two']);
  });

  it('finds a function that writes a file and renames it into place', () => {
    expect(
      idioms(
        'packages/cli/src/a.ts',
        [
          "import { rename, writeFile } from 'node:fs/promises';",
          'export async function place(path: string, text: string) {',
          '  await writeFile(`${path}.tmp`, text);',
          '  await rename(`${path}.tmp`, path);',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['atomic-write place']);
  });

  it('charges a write and a rename to the function that makes each call', () => {
    expect(
      idioms(
        'packages/cli/src/a.ts',
        [
          "import { renameSync, writeFileSync } from 'node:fs';",
          'export function outer(path: string) {',
          "  const write = () => writeFileSync(path, '');",
          "  renameSync(path, `${path}.old`);",
          '  return write;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('leaves the owner of each idiom alone', () => {
    const digest = "import { createHash } from 'node:crypto';\nexport const d = (t: string) => createHash('sha256').update(t);";
    const order = 'export const o = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);';

    expect(idioms('packages/sense/src/digest.ts', digest)).toEqual([]);
    expect(idioms('packages/core/src/segment/index.ts', order)).toEqual([]);
  });

  it('reads production sources, not the files a runner collects', () => {
    expect((sources() as readonly string[]).filter((file) => /\.(test|spec|check|measure)\.[cm]?tsx?$/.test(file))).toEqual([]);
  });

  it('refuses a file it cannot parse rather than finding nothing in it', () => {
    expect(() => sitesIn('packages/cli/src/a.ts', 'const = ;')).toThrow('packages/cli/src/a.ts');
  });

  it.todo('reads the Rust addon, which writes atomically in eight files — needs a Rust reader for the three idioms');
});

describe('answers with an owner', () => {
  const found = sites() as readonly Site[];
  const now = counted(found) as readonly Row[];
  const before = JSON.parse(readFileSync(BASELINE, 'utf8')) as readonly Row[];
  const key = (row: Row): string => `${row.idiom} ${row.at}`;
  const recorded = new Map(before.map((row) => [key(row), row.count]));
  const counts = new Map(now.map((row) => [key(row), row.count]));

  it('are not computed again', () => {
    const grown = now.filter((row) => row.count > (recorded.get(key(row)) ?? 0));
    const report = grown
      .flatMap((row) => {
        const here = found.filter((site) => site.idiom === row.idiom && site.at === row.at);
        return here.map((site) => `  ${site.at}:${site.line} ${site.name ?? ''} — ${row.idiom}`);
      })
      .join('\n');
    const owners = [...new Set(grown.map((row) => row.idiom))]
      .map((idiom) => `  ${idiom}: ${IDIOMS[idiom].owner}${nearest(idiom, grown)}`)
      .join('\n');

    expect(
      grown.length === 0
        ? ''
        : `${grown.length} file(s) compute an answer that has an owner:\n\n${report}\n\n` +
            `Call the owner instead:\n\n${owners}\n\n` +
            'If the owner cannot serve this caller, say why at the site and record it with `yarn owners --write`.',
    ).toBe('');

    function nearest(idiom: Row['idiom'], rows: readonly Row[]): string {
      if (IDIOMS[idiom].owns.length > 0) return '';
      const packages = new Set(rows.filter((row) => row.idiom === idiom).map((row) => packageOf(row.at)));
      const writers = before
        .filter((row) => row.idiom === idiom && packages.has(packageOf(row.at)))
        .map((row) => row.at);
      return writers.length === 0 ? '' : ` (${writers.join(', ')})`;
    }
  });

  it('leave the baseline no longer than what it records', () => {
    const closed = before
      .filter((row) => (counts.get(key(row)) ?? 0) < row.count)
      .map((row) => `${key(row)}: ${row.count} recorded, ${counts.get(key(row)) ?? 0} now`);

    expect(
      closed.length === 0
        ? ''
        : `${closed.length} recorded row(s) moved to their owner:\n\n  ${closed.join('\n  ')}\n\n` +
            'Tighten the ratchet with `yarn owners --write`.',
    ).toBe('');
  });

  it.todo('point a new atomic writer at its owner — needs one package to own atomic writing for every package that writes');

  it('are read from a repository that was actually read', () => {
    // A reader that fails by returning less would empty both lists, and an
    // empty list recorded is a check that agrees with that bug forever.
    expect(found.length + before.length).toBeGreaterThan(0);
  });
});

const packageOf = (file: string): string => file.split('/').slice(0, 2).join('/');
