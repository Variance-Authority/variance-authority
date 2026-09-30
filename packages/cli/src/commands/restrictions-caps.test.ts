import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from '../exit.js';

/** `variance restrictions` checking a `maxLayer`, through the command a person types, over a chain of six packages. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-caps-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];

/** `a` is layer 1 and each package takes the one before it, so `f` is layer 6. */
function checkout(rules: unknown): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-caps-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  write('.relations.json', JSON.stringify(rules));
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
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
}

/** Runs the CLI in process and collects what it wrote and how it exited. */
async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance restrictions with a maxLayer', () => {
  it('refuses an entry that mixes a ceiling with an import rule instead of dropping half of it', async () => {
    checkout([{ from: '.', to: '.', type: 'restricted', for: '.', maxLayer: 5 }]);
    await run(['index']);

    const refused = await run(['restrictions']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('does not take `from`, `to`, `type`');
  });

  it('names each package above its ceiling with the layer, the ceiling, the message and the file, and exits 1', async () => {
    checkout([{ for: 'packages', maxLayer: 4, message: 'keep the tree shallow' }]);
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe(
      [
        '@t/e is layer 5, above the ceiling of 4: keep the tree shallow (.relations.json)',
        '@t/f is layer 6, above the ceiling of 4: keep the tree shallow (.relations.json)',
        '2 packages above a layer ceiling.',
        '',
      ].join('\n'),
    );
  });

  it('holds only the packages a glob names', async () => {
    checkout([{ for: 'packages/b*', maxLayer: 1 }]);
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.out).toBe('@t/b is layer 2, above the ceiling of 1 (.relations.json)\n1 package above a layer ceiling.\n');
  });

  it('exits 0 and says layers were checked when every package is under its ceiling', async () => {
    checkout([{ for: 'packages', maxLayer: 6 }]);
    await run(['index']);

    expect(await run(['restrictions'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: 'No import or layer breaks the rules in 1 .relations.json file.\n',
    });
  });

  it('refuses a ceiling that is not a whole number from 1, naming the file', async () => {
    checkout([{ for: 'packages', maxLayer: 0 }]);
    await run(['index']);

    const refused = await run(['restrictions']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('.relations.json, rule 1');
  });
});
