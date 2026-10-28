import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over the imports inside the package that declares a
 * name and the ones from other packages, each listed under its own heading
 * and counted apart, and over the lines of an importing file that use what
 * its import binds: the import names the declaration, the lines after it are
 * where the file uses it.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-in-package-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** The sites listed under `heading`. */
function section(out: string, heading: string): readonly string[] {
  const lines = out.split('\n');
  const at = lines.indexOf(heading);
  if (at === -1) return [];
  const after = lines.slice(at + 2);
  const end = after.findIndex((line) => !/^\S+:\d+ — /.test(line));
  return end === -1 ? after : after.slice(0, end);
}

describe('variance ask uses inside the declaring package', () => {
  it('lists the imports inside the declaring package apart from the ones from other packages, each with the lines that use it', async () => {
    checkout({
      'packages/lib/src/shout.ts': [
        "import { greet as hail } from './greet.js';",
        '',
        'export const shout = (name: string): string =>',
        '  hail(name).toUpperCase();',
        "export const whisper = (name: string): string => hail(name).toLowerCase();",
        'function local(hail: string): string {',
        '  return hail;',
        '}',
        'export const quiet = local;',
        '',
      ].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`greet` [function] is imported in 2 places: 1 from another package and 1 inside @acme/lib.');
    expect(section(out, 'Source, inside @acme/lib:')).toEqual(['packages/lib/src/shout.ts:1 — @acme/lib (as hail); used on lines 4, 5']);
    expect(section(out, 'Source, from other packages:')).toEqual(['apps/app/src/hello.ts:1 — @acme/app; used on line 2']);
    expect(out).not.toMatch(/^Source:$/m);
  });

  it('says one count under one heading when no package declares the name', async () => {
    checkout({
      'tools/shared.ts': 'export const shared = 1;\n',
      'tools/a.ts': "import { shared } from './shared.js';\nexport const a = shared;\n",
      'tools/b.ts': "import { shared } from './shared.js';\nexport const b = shared;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'shared']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/is imported in 2 places[.,;]/);
    expect(out).not.toContain('inside ,');
    expect(out).not.toMatch(/inside :$/m);
    expect(out).toMatch(/^Source:$/m);
  });

  it('names the package the imports are inside of when another package publishes the name', async () => {
    checkout({
      'packages/lib/src/shout.ts': "import { greet } from './greet.js';\nexport const shout = greet('x');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('names the 2 places that import this: 1 from another package and 1 inside @acme/lib');
  });
});
