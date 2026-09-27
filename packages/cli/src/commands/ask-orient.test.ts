import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask orient`, through the command a person types: the files are
 * named by the caller, the packages are read from the index `variance index`
 * published, and the recording this checkout never made is said to be absent.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-orient-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['XDG_CACHE_HOME'];
});

/** Two packages, one importing two names from the other through its manifest. */
function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-orient-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    'packages/cart/package.json': JSON.stringify({ name: '@t/cart', exports: { '.': './src/index.ts' } }),
    'packages/cart/src/index.ts': "export { priceOf } from './price.js';\nexport const currency = 'EUR';\n",
    'packages/cart/src/price.ts': '/** The price of one line, with tax. */\nexport const priceOf = (amount: number) => amount * 1.2;\n',
    'packages/checkout/package.json': JSON.stringify({ name: '@t/checkout', dependencies: { '@t/cart': '*' } }),
    'packages/checkout/src/total.ts':
      "import { priceOf, currency } from '@t/cart';\n/** The total price of a basket. */\nexport const total = (amounts: number[]) => `${amounts.map(priceOf).join('+')} ${currency}`;\n",
    'packages/checkout/src/label.ts': "import { priceOf } from '@t/cart';\nexport const label = (amount: number) => `price ${priceOf(amount)}`;\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
  symlinkSync('../../packages/cart', join(root, 'node_modules/@t/cart'));
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

/**
 * Four families of five packages, each member importing the members before it,
 * and the first shop package importing the first tool: enough packages for the
 * map to split the checkout into areas.
 */
function families(tracked = true): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-orient-map-')));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('.gitignore', 'node_modules\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*/*'] }));
  for (const family of ['admin', 'data', 'shop', 'tools']) {
    for (let member = 0; member < 5; member += 1) {
      const name = `${family}-${member}`;
      const takes = Array.from({ length: member }, (_, earlier) => `${family}-${earlier}`);
      if (name === 'shop-0') takes.push('tools-0');
      const dependencies = Object.fromEntries(takes.map((taken) => [`@t/${taken}`, '*']));
      write(`packages/${family}/${name}/package.json`, JSON.stringify({ name: `@t/${name}`, exports: { '.': './src/index.ts' }, dependencies }));
      const imports = takes.map((taken) => `import { ${taken.replace('-', '')} } from '@t/${taken}';\n`).join('');
      const used = takes.map((taken) => taken.replace('-', '')).join(', ');
      write(`packages/${family}/${name}/src/index.ts`, `${imports}export const ${name.replace('-', '')} = [${used}];\n`);
      mkdirSync(join(root, 'node_modules/@t'), { recursive: true });
      symlinkSync(`../../packages/${family}/${name}`, join(root, `node_modules/@t/${name}`));
    }
  }
  process.chdir(root);
  if (!tracked) return root;
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask orient', () => {
  it('without files and before `variance index`, says no code map is kept and names the command that builds one', async () => {
    const root = checkout();

    expect(await run(['ask', 'orient'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out:
        `No code map is kept beside the source index at ${sourceIndexPath(root)}; \`variance index\` folds one. ` +
        'With files in hand, `files` reads the graph around them.\n',
    });
  });

  it('says why `variance index` folded no map, there and when the map is asked for', async () => {
    const root = checkout();
    writeFileSync(join(root, 'packages/cart/package.json'), '{}');
    writeFileSync(join(root, 'packages/checkout/package.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@t/shop', private: true }));

    expect((await run(['index'])).out.split('\n')[1]).toBe("code map: none, because the root's is the only named manifest");
    expect((await run(['ask', 'orient'])).out).toBe(
      `The source index at ${sourceIndexPath(root)} was folded into no code map, because the root's is the only named manifest. ` +
        'With files in hand, `files` reads the graph around them.\n',
    );
  });

  it('without files, prints the code map `variance index` built, and one area of it with --area', async () => {
    const root = families();

    const indexed = await run(['index']);
    expect(indexed.code).toBe(EXIT_CLEAN);
    expect(indexed.out.split('\n')[1]).toBe('code map: 20 packages in 4 areas, 1 deep, over 6 dependency layers');

    expect(await run(['ask', 'orient'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `# ${basename(root)}: 20 packages in 6 dependency layers (0 takes nothing), 20 source files, 4 areas`,
        '1 packages/admin/ admin · 5 pkg, 5 files · layers 0–4 (median 2)',
        '2 packages/data/ data · 5 pkg, 5 files · layers 0–4 (median 2)',
        '3 packages/shop/ shop · 5 pkg, 5 files · layers 1–5 (median 3) · uses 4 100%',
        '4 packages/tools/ tools · 5 pkg, 5 files · layers 0–4 (median 2) · front: tools-0 100%',
        '',
      ].join('\n'),
    });
    expect(await run(['ask', 'orient', '--area', '3'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        '# 3 packages/shop/ shop: 5 packages in dependency layers 1–5 of 6, 5 source files, 0 areas',
        '  packages: shop-0, shop-1, shop-2, shop-3, shop-4',
        '',
      ].join('\n'),
    });
  });

  it('says why a checkout git cannot list is folded into no map', async () => {
    families(false);

    const indexed = await run(['index', '--no-git']);

    expect(indexed.code).toBe(EXIT_CLEAN);
    expect(indexed.out.split('\n')[1]).toBe(
      'code map: none, because the source index holds no file records; ' +
        'git could not list the checkout, so its files are the ones the index holds and its manifests the ones found beside them',
    );
  });

  it.todo(
    'a checkout git cannot list is folded into a code map from the files its index holds and the manifests beside them — ' +
      'needs `variance index` to keep a file record for each file it parses outside git, which it keeps only as parses',
  );

  it('refuses an area the map does not have, and an area asked together with files', async () => {
    families();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const unknown = await run(['ask', 'orient', '--area', '9']);
    expect(unknown.code).toBe(EXIT_OPERATOR);
    expect(unknown.err).toContain('the code map has no area `9`; the top page, asked with no `area`, lists the areas');

    const both = await run(['ask', 'orient', '--area', '1', '--files', 'packages/shop/shop-0/src/index.ts']);
    expect(both.code).toBe(EXIT_OPERATOR);
    expect(both.out).toBe('');
  });

  it('answers with the files, the names crossing each package, the absent recording and journeys, and what to ask next', async () => {
    const root = checkout();
    const indexed = await run(['index']);
    expect(indexed.code).toBe(EXIT_CLEAN);
    expect(indexed.out.split('\n')[2]).toBe(`journeys: not prepared: nothing is recorded at ${testCoverageFile(root)}.cases.bin`);

    const answered = await run(['ask', 'orient', '--files', 'packages/checkout/src/total.ts:2,./packages/cart/src/price.ts,src/gone.ts']);

    expect(answered).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        '3 files asked about:',
        '  packages/checkout/src/total.ts  @t/checkout',
        '  packages/cart/src/price.ts      @t/cart',
        '  src/gone.ts                     not in the source index',
        '',
        `Packages, from the source index at ${sourceIndexPath(root)} (4 files indexed).`,
        "A use is one file importing one name from another package. A package's share is of the uses on that side; " +
          "a name's share is of every use the package exporting it gets from outside.",
        '',
        '@t/checkout  packages/checkout',
        '  Takes from, 1 package, 3 uses:',
        '    100%  @t/cart  priceOf 67%, currency 33%',
        '  Used by: no package in this checkout.',
        '',
        '@t/cart  packages/cart',
        '  Takes from: no package in this checkout.',
        '  Used by, 1 package, 3 uses:',
        '    100%  @t/checkout  priceOf 67%, currency 33%',
        '',
        `Recorded cases: none read from ${testCoverageFile(root)}.cases.bin, nothing is recorded there. A run with \`withTestSelection\` records them.`,
        '',
        'Journeys: not prepared: there is no recording to walk. `variance index` prepares them from the latest recording.',
        '',
        'Narrower questions:',
        '  variance ask uses --name priceOf --package @t/cart',
        '  variance ask symbol --name priceOf --package @t/cart',
        '',
      ].join('\n'),
    });
  });
});
