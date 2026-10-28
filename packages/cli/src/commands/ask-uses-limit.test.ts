import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses --limit`, which every other listing question takes: the
 * rows shown per section, sites and the lines of the declaring file alike,
 * every row still counted, and the rest said, each shown site marked with the
 * name its import binds.
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
    expect(out).toContain('`greet` [function] is imported in 5 places');
    expect(sites(out)).toEqual(sites(all.out).slice(0, 2));
    expect(out).toContain('… 3 more not shown; a higher `--limit` shows them.');
  });

  it('cuts the imports of a name its module keeps to itself at the same limit', async () => {
    checkout({
      'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
      'packages/kit/src/lib.rs': 'mod lexicon;\n',
      'packages/kit/src/lexicon.rs': '#[path = "lexicon_a.rs"]\nmod a;\n#[path = "lexicon_b.rs"]\nmod b;\n#[path = "lexicon_c.rs"]\nmod c;\n\nfn flag() {}\n',
      'packages/kit/src/lexicon_a.rs': 'use super::flag;\n',
      'packages/kit/src/lexicon_b.rs': 'use super::flag;\n',
      'packages/kit/src/lexicon_c.rs': 'use super::flag;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const all = await run(['ask', 'uses', '--name', 'flag']);
    expect(all.code).toBe(EXIT_CLEAN);
    expect(all.out).toContain('`flag` [function] is declared, not exported, at packages/kit/src/lexicon.rs:8');
    const rust = (out: string): readonly string[] => out.split('\n').filter((line) => /^\S+\.rs:\d+\b/.test(line));
    expect(rust(all.out)).toHaveLength(3);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'flag', '--limit', '1']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('Imported in 3 places, all inside @acme/kit.');
    expect(rust(out)).toEqual(rust(all.out).slice(0, 1));
    expect(out).toContain('… 2 more not shown; a higher `--limit` shows them.');
  });

  it('cuts the lines of the declaring file at the same limit', async () => {
    checkout({
      'packages/lib/src/greet.ts': [
        'export function greet(name: string): string {',
        '  return name;',
        '}',
        "const loud = (name: string) => greet(name).toUpperCase();",
        "export const a = greet('a');",
        "export const b = loud(greet('b'));",
        '',
      ].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const own = (out: string): readonly string[] => {
      const lines = out.split('\n');
      const at = lines.indexOf('Used in packages/lib/src/greet.ts, which declares it:');
      if (at === -1) return [];
      const after = lines.slice(at + 2);
      const end = after.findIndex((line) => !/^\S+:\d+ — /.test(line));
      return end === -1 ? after : after.slice(0, end);
    };
    const all = await run(['ask', 'uses', '--name', 'greet']);
    expect(all.code).toBe(EXIT_CLEAN);
    expect(own(all.out)).toHaveLength(3);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'greet', '--limit', '1']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(own(out)).toEqual(own(all.out).slice(0, 1));
    expect(out).toContain('… 2 more not shown; a higher `--limit` shows them.');
  });

  it('marks each site it shows with the name its import binds, and counts the renamed ones it cuts', async () => {
    checkout(Object.fromEntries(
      ['a', 'b', 'c', 'd'].map((one) => [`apps/app/src/greet-${one}.ts`, `import { greet as ${one}Greet } from '@acme/lib';\nexport const ${one} = ${one}Greet('${one}');\n`]),
    ));
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const all = await run(['ask', 'uses', '--name', 'greet']);
    const { code, out } = await run(['ask', 'uses', '--name', 'greet', '--limit', '2']);
    expect(code).toBe(EXIT_CLEAN);
    expect(sites(out)).toEqual(sites(all.out).slice(0, 2));
    expect(sites(all.out).filter((line) => / \(as [a-d]Greet\); used on line 2$/.test(line))).toHaveLength(4);
    expect(out).toContain('… 3 more not shown; a higher `--limit` shows them.');
  });
});
