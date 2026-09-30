import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from '../exit.js';

/** `variance restrictions`, through the command a person types, over a checkout with one fenced package. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-restrict-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(rules: string | undefined): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-restrict-')));
  const files: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ private: true }),
    'core/index.ts': "export const core = 1;\n",
    'core/inner.ts': "import { core } from './index';\nexport const inner = core;\n",
    'app/main.ts': "import { core } from '../core/index';\nexport const main = core;\n",
    'app/other.ts': "import { main } from './main';\nexport const other = main;\n",
  };
  if (rules !== undefined) files['core/.relations.json'] = rules;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
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

const FENCE = JSON.stringify([
  { from: '.', to: '.', type: 'allowed' },
  { to: '.', type: 'restricted', message: 'core is internal' },
]);

describe('variance restrictions', () => {
  it('names the import that breaks a fence, with the rule file and its message, and exits 1', async () => {
    checkout(FENCE);
    await run(['index']);

    const found = await run(['restrictions']);

    expect(found.code).toBe(EXIT_REVIEW);
    expect(found.out).toBe('app/main.ts → core/index.ts: core is internal (core/.relations.json)\n1 restricted import.\n');
  });

  it('exits 0 and says how many rule files it read when no import breaks one', async () => {
    checkout(JSON.stringify([{ to: 'nowhere', type: 'restricted' }]));
    await run(['index']);

    expect(await run(['restrictions'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: 'Nothing breaks the rules in 1 .relations.json file.\n',
    });
  });

  it('says no import is restricted, rather than none broke a rule, when no rule file is tracked', async () => {
    checkout(undefined);
    await run(['index']);

    expect((await run(['restrictions'])).out).toBe('No .relations.json is tracked in this checkout, so nothing is restricted.\n');
  });

  it('refuses a rule file that is not a list of typed rules, naming the file', async () => {
    checkout(JSON.stringify([{ to: '.' }]));
    await run(['index']);

    const refused = await run(['restrictions']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('core/.relations.json, rule 1');
  });
});
