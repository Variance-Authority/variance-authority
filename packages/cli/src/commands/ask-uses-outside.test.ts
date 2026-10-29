import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` answers who depends on a declaration of this workspace.
 * A name no file here declares, but that a file imports from a package
 * outside the workspace or a runtime module, is `discover --imports`'s question, and the
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

  it('names a source a namespace reads the name off, and not a path alias or a `paths` mapping that did not resolve', async () => {
    checkout({
      'packages/lib/src/whole.ts': "import * as oxc from 'oxc-parser';\nexport const whole = oxc.parseSync;\n",
      'apps/app/src/alias.ts': "import { parseSync } from '@/lib/ghost';\nexport const alias = parseSync;\n",
      'apps/app/src/tilde.ts': "import { parseSync } from '~/lib/ghost';\nexport const tilde = parseSync;\n",
      'apps/app/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { 'internal/*': ['src/internal/*'] } } }),
      'apps/app/src/bare.ts': "import { parseSync } from 'internal/ghost';\nexport const bare = parseSync;\n",
    });
    expect((await run(['index'])).code).toBe(0);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(out.match(/`parseSync` is imported from .+? the files that import it\./g)).toEqual([
      '`parseSync` is imported from `oxc-parser`, outside this workspace: `variance ask discover --imports oxc-parser#parseSync` lists the files that import it.',
    ]);
  });

  it('points at discover questions that each list the files importing the name from that source', async () => {
    checkout({
      'packages/lib/src/parse.ts': "import { parseSync } from 'oxc-parser';\nexport const parsed = parseSync('a.ts', '');\n",
      'packages/lib/src/whole.ts': "import * as oxc from 'oxc-parser';\nexport const whole = oxc.parseSync;\n",
      'packages/lib/src/again.ts': "import { parseSync as parse } from 'other-parser';\nexport const again = parse;\n",
    });
    expect((await run(['index'])).code).toBe(0);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    const asked = [...out.matchAll(/`variance ask discover --imports ([^`]+)`/g)].map((match) => match[1] ?? '');
    expect(asked).toEqual(['other-parser#parseSync', 'oxc-parser#parseSync']);
    const listed: string[] = [];
    for (const imports of asked) listed.push((await run(['ask', 'discover', '--imports', imports])).out);
    expect(listed[0]).toContain('packages/lib/src/again.ts');
    expect(listed[1]).toContain('packages/lib/src/parse.ts');
    expect(listed[1]).toContain('packages/lib/src/whole.ts');
  });

  it('says nothing of discover for a name no file imports', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(0);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(out).not.toContain('discover');
  });
});
