import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask search --limit`, as every listing question takes it: the rows
 * shown in each list of the answer, every row still counted and the rest said,
 * each cut naming the `--limit` that shows them; each list's own cap when it
 * is not said.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-search-limit-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const numbered = (prefix: string, count: number): readonly string[] => Array.from({ length: count }, (_, at) => `${prefix}${String(at).padStart(2, '0')}`);

/** 45 published names and 30 exported ones that hold `version`: past the caps of 40 and 25. */
const VERSIONS = {
  'packages/lib/src/index.ts': `${numbered('versionPub', 45).map((name) => `export const ${name} = 1;`).join('\n')}\n`,
  ...Object.fromEntries(numbered('versionKit', 30).map((name) => [`packages/kit/src/${name}.ts`, `export const ${name} = 1;\n`])),
};

/** The rows of `out` that name one of the numbered names starting `prefix`, published or exported. */
const rows = (out: string, prefix: string): readonly string[] => out.split('\n').filter((line) => new RegExp(`^(@acme/lib · )?${prefix}\\d\\d `).test(line));

describe('variance ask search --limit', () => {
  it('cuts each list at its own cap when no limit is said, and names the limit that shows the rest', async () => {
    checkout(VERSIONS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'search', '--query', 'version']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('45 published matches for `version`');
    expect(rows(out, 'versionPub')).toHaveLength(40);
    expect(out).toContain('30 more names are exported somewhere in the repository without being published:');
    expect(rows(out, 'versionKit')).toHaveLength(25);
    expect(out.split('\n').filter((line) => line === '5 more not shown; a higher `--limit` shows them.')).toHaveLength(2);
    expect(out).not.toMatch(/not shown\.$/m);
  });

  it('shows every row up to the limit in each list', async () => {
    checkout(VERSIONS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const capped = await run(['ask', 'search', '--query', 'version']);
    const { code, out, err } = await run(['ask', 'search', '--query', 'version', '--limit', '100']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(rows(out, 'versionPub')).toHaveLength(45);
    expect(rows(out, 'versionPub').slice(0, 40)).toEqual(rows(capped.out, 'versionPub'));
    expect(rows(out, 'versionKit')).toHaveLength(30);
    expect(out).not.toContain('not shown');
  });

  it('cuts every list at a limit below its cap, each saying the rest', async () => {
    checkout(VERSIONS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'search', '--query', 'version', '--limit', '3']);
    expect(code).toBe(EXIT_CLEAN);
    expect(rows(out, 'versionPub')).toHaveLength(3);
    expect(out).toContain('42 more not shown; a higher `--limit` shows them.');
    expect(out).toContain('27 more not shown; a higher `--limit` shows them.');
  });

  it('answers as data at the limit, and at the caps when none is said', async () => {
    checkout(VERSIONS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const all = await run(['ask', 'search', '--query', 'version', '--limit', '100', '--format', 'json']);
    expect(all.err).toBe('');
    expect(all.code).toBe(EXIT_CLEAN);
    const wide = JSON.parse(all.out) as { published: { total: number; shown: unknown[] }; exported: { total: number; shown: unknown[] } };
    expect(wide.published).toMatchObject({ total: 45 });
    expect(wide.published.shown).toHaveLength(45);
    expect(wide.exported.shown).toHaveLength(30);

    const plain = await run(['ask', 'search', '--query', 'version', '--format', 'json']);
    const capped = JSON.parse(plain.out) as typeof wide;
    expect(capped.published.shown).toHaveLength(40);
    expect(capped.exported.shown).toHaveLength(25);
    expect(capped.published.shown).toEqual(wide.published.shown.slice(0, 40));
    expect(plain.out).not.toContain('"limit"');
  });
});
