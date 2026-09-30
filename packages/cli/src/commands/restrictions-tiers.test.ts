import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from '../exit.js';

/** `variance layers` and `variance restrictions` over declared tiers and transitive rules, through the command a person types. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-tiers-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];

interface Fixture {
  readonly tiers?: unknown;
  readonly rules?: unknown;
  /** Extra files, by path. */
  readonly files?: Record<string, string>;
}

/** Six packages in a chain, each taking the one before it, and a `tools/` folder no package should rest on. */
function checkout(fixture: Fixture): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-tiers-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  if (fixture.tiers !== undefined) write('variance.config.json', JSON.stringify({ tiers: fixture.tiers }));
  if (fixture.rules !== undefined) write('.relations.json', JSON.stringify(fixture.rules));
  write('tools/helper.ts', 'export const helper = 1;\n');
  NAMES.forEach((name, at) => {
    const takes = at === 0 ? [] : [NAMES[at - 1]!];
    write(`packages/${name}/package.json`, JSON.stringify({
      name: `@t/${name}`,
      exports: { '.': './src/index.ts' },
      dependencies: Object.fromEntries(takes.map((taken) => [`@t/${taken}`, '*'])),
    }));
    write(
      `packages/${name}/src/index.ts`,
      `${takes.map((taken) => `import { ${taken} } from '@t/${taken}';\n`).join('')}export const ${name} = [${takes.join(', ')}];\n`,
    );
    mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
    symlinkSync(`../../packages/${name}`, join(root, `node_modules/@t/${name}`));
  });
  for (const [path, text] of Object.entries(fixture.files ?? {})) write(path, text);
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

/** Keep the index and its map as the base, under a name the next `variance index` does not overwrite. */
function keepAsBase(root: string): string {
  const index = sourceIndexPath(root);
  const base = join(tmpdir(), `va-tiers-base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  copyFileSync(index, base);
  copyFileSync(`${index}.map`, `${base}.map`);
  return base;
}

describe('variance layers with tiers declared', () => {
  it('places each package by the lines its closure pulls in, and says once that installed packages are not counted', async () => {
    checkout({ tiers: [100, 8, 4] });
    await run(['index']);

    const listed = await run(['layers']);

    expect(listed.code).toBe(EXIT_CLEAN);
    expect(listed.out).toBe([
      '1 @t/a tier 2 (1 line in 1 file)',
      '2 @t/b tier 2 (3 lines in 2 files)',
      '3 @t/c tier 1 (5 lines in 3 files)',
      '4 @t/d tier 1 (7 lines in 4 files)',
      '5 @t/e tier 0 (9 lines in 5 files)',
      '6 @t/f tier 0 (11 lines in 6 files)',
      '',
      'Installed packages are not in the code map, so no closure counts their lines.',
      '',
    ].join('\n'));
  });

  it('names the package that caused a tier move and counts the ones it carried', async () => {
    const root = checkout({ tiers: [100, 8, 4] });
    await run(['index']);
    const base = keepAsBase(root);
    // `b` stops taking `a`: every closure above it loses three lines, which moves `c` and `e` up a tier.
    writeFileSync(join(root, 'packages/b/package.json'), JSON.stringify({ name: '@t/b', exports: { '.': './src/index.ts' } }));
    writeFileSync(join(root, 'packages/b/src/index.ts'), 'export const b = [];\n');
    await run(['index']);

    const told = await run(['layers', '--against', base]);

    expect(told.code).toBe(EXIT_CLEAN);
    expect(told.out.split('\n').slice(-3)).toEqual([
      '1 package changed tier. 2 other packages moved with it.',
      '@t/b tier 2 → tier 2 (3 → 1 lines): its own code 2 → 1 lines, no longer takes @t/a. Carried 2 packages.',
      '',
    ]);
  });

  it('stops on a `tiers` value its rules refuse, naming the file', async () => {
    checkout({ tiers: [100, 200] });
    await run(['index']);

    const refused = await run(['layers']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('variance.config.json: "tiers" must decrease');
  });
});

describe('variance restrictions with a maxTier', () => {
  it('names each package whose closure is over its budget, and exits 1', async () => {
    checkout({ tiers: [100, 8, 4], rules: [{ for: 'packages/*', maxTier: 1, message: 'a leaf stays small' }] });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe([
      '@t/e pulls in 9 lines, over the 8 of tier 1: a leaf stays small (.relations.json)',
      '@t/f pulls in 11 lines, over the 8 of tier 1: a leaf stays small (.relations.json)',
      '2 packages over a tier budget.',
      '',
    ].join('\n'));
  });

  it('prints a package whose known lines fit but whose closure is partly unsized as undecided, and exits 0', async () => {
    checkout({
      tiers: [100, 50, 4],
      rules: [{ for: 'packages/f', maxTier: 1 }],
      files: { 'packages/f/src/index.ts': "import { e } from '@t/e';\nimport { gone } from './gone';\nexport const f = [e, gone];\n" },
    });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_CLEAN);
    expect(found.out).toBe([
      '@t/f pulls in 12 lines and 1 file it could not size, within the 50 of tier 1 (.relations.json); undecided',
      '1 package undecided.',
      '',
    ].join('\n'));
    expect((await run(['layers'])).out).toContain('6 @t/f tier ≤ 1 (12 lines in 6 files, 1 file unsized)');
  });

  it('refuses a maxTier when the root config declares no tiers', async () => {
    checkout({ rules: [{ for: 'packages/*', maxTier: 1 }] });
    await run(['index']);

    const refused = await run(['restrictions']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('.relations.json, rule 1: `maxTier` names a tier, and the variance.config.json at the repository root declares no `tiers`');
  });

  it('refuses tier 0, which caps nothing, and a tier the config does not declare', async () => {
    checkout({ tiers: [100, 8, 4], rules: [{ for: 'packages/*', maxTier: 0 }] });
    expect((await run(['restrictions'])).err).toContain('`maxTier` is a whole number from 1 to 2');
    checkout({ tiers: [100, 8, 4], rules: [{ for: 'packages/*', maxTier: 3 }] });
    expect((await run(['restrictions'])).code).toBe(EXIT_OPERATOR);
  });
});

describe('variance restrictions with a transitive rule', () => {
  const rules = [{ from: 'packages/*', to: 'tools/*', type: 'restricted', transitive: true, message: 'packages never rest on tools' }];
  const files = {
    'examples/shared.ts': "import { helper } from '../tools/helper';\nexport const shared = helper;\n",
    'packages/c/src/index.ts': "import { b } from '@t/b';\nimport { shared } from '../../../examples/shared';\nexport const c = [b, shared];\n",
    'packages/a/src/index.test.ts': "import { helper } from '../../../tools/helper';\nexport const tested = helper;\n",
  };

  it('reports the import a shipped chain reaches a restricted file by, with the chain and the shipped files behind it', async () => {
    checkout({ rules, files });
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe([
      'packages/c/src/index.ts → examples/shared.ts → tools/helper.ts: packages never rest on tools (.relations.json); 4 shipped files reach examples/shared.ts',
      '1 restricted chain.',
      '',
    ].join('\n'));
  });

  it('refuses `transitive` written on a ceiling, which holds packages rather than chains', async () => {
    checkout({ rules: [...rules, { for: 'packages/*', maxLayer: 9, transitive: true }] });
    const refused = await run(['restrictions']);
    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('does not take `transitive`');
  });
});
