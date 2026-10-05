import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance layers`, through the command a person types, over a checkout of a chain of packages. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-layers-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Six packages in a chain: each takes the one before it, and `f` may also take `a` directly. */
function checkout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-layers-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));
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
  const base = join(tmpdir(), `va-layers-base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  copyFileSync(index, base);
  if (existsSync(`${index}.map`)) copyFileSync(`${index}.map`, `${base}.map`);
  return base;
}

describe('variance layers', () => {
  it('lists each package with its layer, counting from 1', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const listed = await run(['layers']);

    expect(listed.code).toBe(EXIT_CLEAN);
    expect(listed.out).toBe(['1 @t/a', '2 @t/b', '3 @t/c', '4 @t/d', '5 @t/e', '6 @t/f', ''].join('\n'));
  });

  it('is empty in markdown, and says so in text, when nothing moved against the base', async () => {
    const root = checkout();
    await run(['index']);
    const base = keepAsBase(root);

    expect(await run(['layers', '--against', base, '--format', 'markdown'])).toEqual({ code: EXIT_CLEAN, err: '', out: '' });
    expect((await run(['layers', '--against', base])).out).toBe('No package changed layer.\n');
  });

  it('names the one package whose dependencies changed and counts the ones it carried', async () => {
    const root = checkout();
    await run(['index']);
    const base = keepAsBase(root);
    // `b` stops taking `a`: it falls to layer 1, and everything above it falls with it.
    writeFileSync(join(root, 'packages/b/package.json'), JSON.stringify({ name: '@t/b', exports: { '.': './src/index.ts' } }));
    writeFileSync(join(root, 'packages/b/src/index.ts'), 'export const b = [];\n');
    await run(['index']);

    const told = await run(['layers', '--against', base, '--format', 'markdown']);

    expect(told.code).toBe(EXIT_CLEAN);
    expect(told.out).toBe([
      '<!-- variance-authority:layers -->',
      '### Dependency layers',
      '',
      '1 package changed its layer by its own dependencies. 4 other packages moved with it.',
      '',
      '- `@t/b` 2 → 1: no longer takes @t/a. Carried 4 packages.',
      '',
    ].join('\n'));
  });

  it('names a package that took another without changing layer', async () => {
    const root = checkout();
    await run(['index']);
    const base = keepAsBase(root);
    // `f` also takes `a`, which sits below it already: no layer moves, one dependency is new.
    writeFileSync(join(root, 'packages/f/package.json'), JSON.stringify({
      name: '@t/f',
      exports: { '.': './src/index.ts' },
      dependencies: { '@t/a': '*', '@t/e': '*' },
    }));
    writeFileSync(join(root, 'packages/f/src/index.ts'), "import { a } from '@t/a';\nimport { e } from '@t/e';\nexport const f = [a, e];\n");
    await run(['index']);

    const told = await run(['layers', '--against', base, '--format', 'markdown']);

    expect(told.code).toBe(EXIT_CLEAN);
    expect(told.out).toBe([
      '<!-- variance-authority:layers -->',
      '### Dependency layers',
      '',
      '1 package changed its own dependencies and kept its layer.',
      '',
      '- `@t/f` 6: takes @t/a.',
      '',
    ].join('\n'));
    expect((await run(['layers', '--against', base])).out).toBe([
      'No package changed layer.',
      '1 package changed its own dependencies and kept its layer.',
      '@t/f 6: takes @t/a.',
      '',
    ].join('\n'));
  });

  it('tells a held package after the layer moves, under one heading', async () => {
    const root = checkout();
    await run(['index']);
    const base = keepAsBase(root);
    // `f` stops taking `e` and falls to layer 1; `e` also takes `a` and keeps its layer, one above `d`.
    writeFileSync(join(root, 'packages/f/package.json'), JSON.stringify({ name: '@t/f', exports: { '.': './src/index.ts' } }));
    writeFileSync(join(root, 'packages/f/src/index.ts'), 'export const f = [];\n');
    writeFileSync(join(root, 'packages/e/package.json'), JSON.stringify({
      name: '@t/e',
      exports: { '.': './src/index.ts' },
      dependencies: { '@t/a': '*', '@t/d': '*' },
    }));
    writeFileSync(join(root, 'packages/e/src/index.ts'), "import { a } from '@t/a';\nimport { d } from '@t/d';\nexport const e = [a, d];\n");
    await run(['index']);

    const told = await run(['layers', '--against', base, '--format', 'markdown']);

    expect(told.out).toBe([
      '<!-- variance-authority:layers -->',
      '### Dependency layers',
      '',
      '1 package changed its layer by its own dependencies.',
      '',
      '- `@t/f` 6 → 1: no longer takes @t/e.',
      '',
      '1 package changed its own dependencies and kept its layer.',
      '',
      '- `@t/e` 5: takes @t/a.',
      '',
    ].join('\n'));
  });

  it('names the dependencies of a package that appeared or vanished', async () => {
    const root = checkout();
    await run(['index']);
    const base = keepAsBase(root);
    // `f` goes, taking its edge to `e` with it; `g` arrives taking `a` and `c`.
    rmSync(join(root, 'packages/f'), { recursive: true });
    mkdirSync(join(root, 'packages/g/src'), { recursive: true });
    writeFileSync(join(root, 'packages/g/package.json'), JSON.stringify({
      name: '@t/g',
      exports: { '.': './src/index.ts' },
      dependencies: { '@t/a': '*', '@t/c': '*' },
    }));
    writeFileSync(join(root, 'packages/g/src/index.ts'), "import { a } from '@t/a';\nimport { c } from '@t/c';\nexport const g = [a, c];\n");
    await run(['index']);

    const told = await run(['layers', '--against', base, '--format', 'markdown']);

    expect(told.out).toBe([
      '<!-- variance-authority:layers -->',
      '### Dependency layers',
      '',
      'Appeared: @t/g 4 (takes @t/a, @t/c)  ',
      'Vanished: @t/f 6 (took @t/e)  ',
      '',
    ].join('\n'));
  });

  it('refuses a base that holds no package layers, rather than reading it as nothing moved', async () => {
    checkout();
    await run(['index']);

    const refused = await run(['layers', '--against', join(tmpdir(), 'va-layers-no-such-index')]);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
  });
});
