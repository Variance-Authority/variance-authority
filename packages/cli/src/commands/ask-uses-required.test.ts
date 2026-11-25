import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask uses` and `variance ask discover --imports` over a name a file
 * takes out of a `require`: destructured, read in place, or read off the name
 * the module is set to.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-required-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const REQUIRED = {
  'packages/kit/src/checks.cjs':
    'function checkA() {}\nfunction checkB() {}\nfunction checkC() {}\nfunction checkD() {}\n\nmodule.exports = { checkA, checkB, checkC, checkD };\n',
  'packages/kit/src/taken.cjs': "const { checkA } = require('./checks.cjs');\ncheckA();\n",
  'packages/kit/src/renamed.cjs': "\nconst { checkA: first } = require('./checks.cjs');\nfirst();\n",
  'packages/kit/src/held.cjs': "const checks = require('./checks.cjs');\n\nchecks.checkB();\n",
  'packages/kit/src/in-place.cjs': "const checkC = require('./checks.cjs').checkC;\ncheckC();\n",
  'packages/kit/src/late.cjs':
    "function late() {\n  const { checkA } = require('./checks.cjs');\n  const checks = require('./checks.cjs');\n  return [checkA, checks.checkB, require('./checks.cjs').checkC];\n}\nlate();\n",
  'packages/kit/src/unread.cjs': "const { checkD } = loader.require('./checks.cjs');\nconst { checkD: named } = require(name);\n",
};

async function answer(...question: readonly string[]): Promise<string> {
  const { code, out } = await run(['ask', ...question]);
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

/** The `file:line` places of the rows `out` lists, sorted. */
function places(out: string): readonly string[] {
  return [...out.matchAll(/^(packages\/kit\/src\/[\w-]+\.cjs:\d+)\b/gm)].map(([, place]) => place ?? '').sort();
}

describe('a name taken out of a require', () => {
  beforeEach(async () => {
    checkout(REQUIRED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('is listed by `uses` in each file that destructures it, renamed or not, at its line', async () => {
    expect(places(await answer('uses', '--name', 'checkA'))).toEqual([
      'packages/kit/src/late.cjs:2',
      'packages/kit/src/renamed.cjs:2',
      'packages/kit/src/taken.cjs:1',
    ]);
  });

  it('is listed by `uses` where it is read off the name the module is set to', async () => {
    const out = await answer('uses', '--name', 'checkB');
    expect(places(out)).toEqual(['packages/kit/src/held.cjs:3', 'packages/kit/src/late.cjs:4']);
    expect(out).not.toContain('nothing in this workspace imports it');
  });

  it('is listed by `uses` where it is read off the call', async () => {
    expect(places(await answer('uses', '--name', 'checkC'))).toEqual(['packages/kit/src/in-place.cjs:1', 'packages/kit/src/late.cjs:4']);
  });

  it('is not read off another object’s `require`, nor one of a computed name', async () => {
    expect(await answer('uses', '--name', 'checkD')).toContain('nothing in this workspace imports it');
  });

  it('is what `discover --imports <file>#<name>` lists those files by', async () => {
    const out = await answer('discover', '--imports', 'packages/kit/src/checks.cjs#checkA');
    expect([...out.matchAll(/^(packages\/kit\/\S+)\n {2}(\d+): imports checkA from \.\/checks\.cjs\b/gm)].map(([, file, line]) => `${file}:${line}`)).toEqual([
      'packages/kit/src/late.cjs:2',
      'packages/kit/src/renamed.cjs:2',
      'packages/kit/src/taken.cjs:1',
    ]);
  });
});
