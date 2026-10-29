import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` answers who depends on a declaration of this workspace.
 * A name no file here declares, but that a file imports from an installed
 * package or a runtime module, is `discover --imports`'s question, and the
 * answer names it.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-outside-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('variance ask uses points a name imported only from outside at discover', () => {
  it('names each source the name is imported from and the question that lists the files', async () => {
    checkout({
      'packages/lib/src/parse.ts': "import { parseSync } from 'oxc-parser';\nexport const parsed = parseSync('a.ts', '');\n",
      'packages/lib/src/again.ts': "import { parseSync as parse } from 'other-parser';\nexport const again = parse;\n",
    });
    expect((await run(['index'])).code).toBe(0);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(out).toContain(
      '`parseSync` is imported from `other-parser` and `oxc-parser`, outside this workspace: `variance ask discover --imports other-parser#parseSync` and `variance ask discover --imports oxc-parser#parseSync` list the files that import it.',
    );
  });

  it('says nothing of discover for a name no file imports', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(0);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(out).not.toContain('discover');
  });
});
