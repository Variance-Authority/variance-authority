import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a method of an interface that classes implement:
 * a class that writes `implements` names the interface, so each of its
 * members is an implementation of the interface's member of that name. An
 * object that takes the interface from where it goes — an argument, a
 * property, a returned value — writes no type on its line, and the answer
 * names the declaration TypeScript's go-to-implementation is asked about.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-implements-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const DEPS = {
  'packages/lib/src/deps.ts': 'export interface Deps {\n  readJourney(): string;\n}\n',
  'packages/lib/src/real.ts': [
    "import type { Deps } from './deps.js';",
    'export class Real implements Deps {',
    '  static readJourney(): string {',
    "    return 'static';",
    '  }',
    '  readJourney(): string {',
    "    return 'real';",
    '  }',
    '}',
    '',
  ].join('\n'),
  'packages/lib/src/run.ts': [
    "import type { Deps } from './deps.js';",
    'export const run = (options: { deps: Deps }) => options.deps;',
    "export const ran = run({ deps: { readJourney: () => 'given' } });",
    '',
  ].join('\n'),
  'packages/kit/src/other.ts': 'interface Deps {\n  readJourney(): string;\n}\nexport class Other implements Deps {\n  readJourney(): string {\n    return "other";\n  }\n}\n',
};

describe('variance ask uses over an interface method', () => {
  it('lists each class that implements the interface, and names the declaration TypeScript finds the rest from', async () => {
    checkout(DEPS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'readJourney', '--file', 'packages/lib/src/deps.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`Deps.readJourney`, declared at packages/lib/src/deps.ts:2, is used in 1 place:');
    expect(out).toMatch(/^packages\/lib\/src\/real\.ts:6 — @acme\/lib, implement$/m);
    expect(out).not.toContain('packages/lib/src/real.ts:3 — @acme/lib, implement');
    expect(out).not.toContain('packages/kit/src/other.ts:5');
    expect(out).toContain(
      'An implementation of `Deps.readJourney` that takes its type from where it goes — an argument, a property, a returned value — writes no type on its line and is not listed: ' +
        "TypeScript's language service's go-to-implementation on packages/lib/src/deps.ts:2 names it.",
    );
  });
});
