import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * A name a file only passes on with `export … from`, renamed or not, and no
 * entry publishes: `uses` and `symbol` lead from the export line to the
 * declaration it passes on, through every file between them.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-passed-on-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const RATES = {
  'packages/kit/src/money/rates.ts': "export { taxOf as levy } from './tax.js';\n",
  'packages/kit/src/money/duty.ts': "export { levy as duty } from './rates.js';\n",
  'packages/kit/src/money/bill.ts': "import { levy } from './rates.js';\nimport { duty } from './duty.js';\nexport const bill = levy(1) + duty(2);\n",
};

const DECLARED = 'which passes on `taxOf`, declared at packages/kit/src/money/tax.ts:1';

describe('a name only passed on', () => {
  it('is answered by uses with the declaration it passes on', async () => {
    checkout(RATES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const levy = await run(['ask', 'uses', '--name', 'levy']);
    expect(levy.code).toBe(EXIT_CLEAN);
    expect(levy.out).toContain(`it is exported at packages/kit/src/money/rates.ts:1, ${DECLARED}.`);

    // Two files deep, renamed twice.
    const duty = await run(['ask', 'uses', '--name', 'duty']);
    expect(duty.code).toBe(EXIT_CLEAN);
    expect(duty.out).toContain(`it is exported at packages/kit/src/money/duty.ts:1, ${DECLARED}.`);
  });

  it('is answered by symbol with the declaration and its line', async () => {
    checkout(RATES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain("export { taxOf as levy } from './tax.js';");
    expect(out).toContain(
      [
        'exported, without being published, at packages/kit/src/money/rates.ts:1 by @acme/kit',
        "export { taxOf as levy } from './tax.js';",
        'It passes on `taxOf`, declared at packages/kit/src/money/tax.ts:1:',
        'export function taxOf(amount: number): number {',
      ].join('\n'),
    );
  });

  it('follows a bare `export *` on the way', async () => {
    checkout({
      'packages/kit/src/money/all.ts': "export * from './tax.js';\n",
      'packages/kit/src/money/charge.ts': "export { taxOf as charge } from './all.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'charge']);
    expect(out).toContain(`at packages/kit/src/money/charge.ts:1, ${DECLARED}, `);
  });

  it('follows a type-only export to the declaration and its members', async () => {
    checkout({
      'packages/kit/src/money/types.ts': 'export interface Rate {\n  percent: number;\n}\n',
      'packages/kit/src/money/fee.ts': "export type { Rate as Fee } from './types.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'Fee']);
    expect(out).toContain('It passes on `Rate`, declared at packages/kit/src/money/types.ts:1:');
    expect(out).toContain('Members:\npackages/kit/src/money/types.ts:2 — percent: number;');
  });

  it('names no declaration when the files only pass the name to each other', async () => {
    checkout({
      'packages/kit/src/money/left.ts': "export { loop } from './right.js';\n",
      'packages/kit/src/money/right.ts': "export { loop } from './left.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const verb of ['uses', 'symbol']) {
      const { out } = await run(['ask', verb, '--name', 'loop']);
      expect(out).not.toContain('passes on');
    }
  });

  it('says nothing more for a name its file declares', async () => {
    checkout(RATES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'unusedRate']);
    expect(out).not.toContain('passes on');
  });
});
