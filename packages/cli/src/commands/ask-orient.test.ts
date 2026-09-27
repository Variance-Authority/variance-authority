import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask orient`, through the command a person types: the words are
 * found by git, the packages are read from the index `variance index`
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

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask orient', () => {
  it('refuses a call without words, and says what it takes', async () => {
    checkout();

    const refused = await run(['ask', 'orient']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
    expect(refused.err).toContain('`variance ask orient` needs --query. It takes words from the task, as `--query "<words>"`');
  });

  it('answers with the files, the names crossing each package, the absent recording, and what to ask next', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'orient', '--query', 'price total']);

    expect(answered).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        '4 tracked files contain one of the words `price total`. The 4 files with the most of them, then the most matching lines:',
        '',
        '  packages/checkout/src/total.ts  2 words, 5 lines  @t/checkout',
        '  packages/cart/src/price.ts      1 word, 2 lines   @t/cart',
        '  packages/checkout/src/label.ts  1 word, 2 lines   @t/checkout',
        '  packages/cart/src/index.ts      1 word, 1 line    @t/cart',
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
        'Narrower questions:',
        '  variance ask uses --name priceOf --package @t/cart',
        '  variance ask symbol --name priceOf --package @t/cart',
        "  variance ask search --query 'price total' --from packages/checkout/src/total.ts",
        '',
      ].join('\n'),
    });
  });
});
