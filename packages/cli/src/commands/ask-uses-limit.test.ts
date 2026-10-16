import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses --limit`, which every other listing question takes: the
 * sites shown per section, every site still counted, and the rest said.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-limit-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const GREETERS = Object.fromEntries(
  ['a', 'b', 'c', 'd'].map((one) => [`apps/app/src/greet-${one}.ts`, `import { greet } from '@acme/lib';\nexport const ${one} = greet('${one}');\n`]),
);

/** The lines of `out` that name one site. */
const sites = (out: string): readonly string[] => out.split('\n').filter((line) => /^\S+\.ts:\d+ — /.test(line));

describe('variance ask uses --limit', () => {
  it('shows that many sites of each kind and counts the rest', async () => {
    checkout(GREETERS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const all = await run(['ask', 'uses', '--name', 'greet']);
    expect(all.code).toBe(EXIT_CLEAN);
    expect(sites(all.out)).toHaveLength(5);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'greet', '--limit', '2']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`greet` is imported in 5 places');
    expect(sites(out)).toEqual(sites(all.out).slice(0, 2));
    expect(out).toContain('… and 3 more; a higher `limit` shows them.');
  });
});
