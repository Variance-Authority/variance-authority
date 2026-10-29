import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` names the files whose imports the index could not
 * resolve to a file when one of them could take the name: a use there is not
 * listed, so an answer that lists none would otherwise hide it.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-unread-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** The line `uses` names the unread files on. */
const unreadOf = (out: string): readonly string[] => out.split('\n').filter((line) => line.includes('could not resolve'));

describe('variance ask uses names the files whose imports did not resolve', () => {
  it('names a file whose unresolved import takes the name or the module whole, and not one that takes another name or an installed package', async () => {
    checkout({
      'packages/lib/src/lost.ts': "import { greet } from './gone.js';\nexport const lost = greet('lost');\n",
      'packages/lib/src/whole.ts': "import * as all from './missing.js';\nexport const whole = all;\n",
      'packages/lib/src/other.ts': "import { shout } from './gone.js';\nexport const other = shout;\n",
      'packages/lib/src/installed.ts': "import { greet } from 'left-pad';\nexport const installed = greet;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^`greet` \[function\] is imported in 1 place/m);
    expect(unreadOf(out)).toEqual([
      '2 files import a specifier the index could not resolve to a file, and each could take `greet`, so a use there is not listed: packages/lib/src/lost.ts, packages/lib/src/whole.ts.',
    ]);
  });

  it('names them beside an answer that finds no import', async () => {
    checkout({ 'packages/kit/src/lost.ts': "import { orphan } from './orphn.js';\nexport const lost = orphan;\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'orphan']);
    expect(out).toMatch(/nothing in this workspace imports it/);
    expect(unreadOf(out)).toEqual([
      '1 file imports a specifier the index could not resolve to a file, and it could take `orphan`, so a use there is not listed: packages/kit/src/lost.ts.',
    ]);
  });

  it('names a file whose import of the declaring package by name did not resolve, and not one of another package', async () => {
    checkout({
      'apps/app/src/gone.ts': "import { greet } from '@acme/lib/src/gone';\nexport const gone = greet('gone');\n",
      'apps/app/src/elsewhere.ts': "import { greet } from '@acme/kit/src/gone';\nexport const elsewhere = greet('elsewhere');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(unreadOf(out)).toEqual([
      '1 file imports a specifier the index could not resolve to a file, and it could take `greet`, so a use there is not listed: apps/app/src/gone.ts.',
    ]);
  });

  it('says nothing when every import resolved', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(unreadOf(out)).toEqual([]);
  });
});
