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

  it("is answered by symbol with the kind, signature and doc of the declaration it passes on", async () => {
    checkout(RATES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(
      [
        'levy [function]',
        'exported, without being published, at packages/kit/src/money/rates.ts:1 by @acme/kit',
        'It passes on `taxOf`, declared at packages/kit/src/money/tax.ts:1:',
        'function taxOf(amount: number): number',
      ].join('\n'),
    );
    expect(out).not.toContain('export {');
    expect(out).not.toContain('export function');
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

  it('follows a chain of stars, lets a named export shadow a star, and names none for two stars that disagree', async () => {
    checkout({
      'packages/kit/src/money/all.ts': "export * from './tax.js';\n",
      'packages/kit/src/money/every.ts': "export * from './all.js';\n",
      'packages/kit/src/money/other.ts': 'export function taxOf(): number {\n  return 0;\n}\n',
      'packages/kit/src/money/shadow.ts': "export * from './other.js';\nexport { taxOf } from './every.js';\n",
      'packages/kit/src/money/both.ts': "export * from './every.js';\nexport * from './other.js';\n",
      'packages/kit/src/money/deep.ts': "export { taxOf as deep } from './every.js';\n",
      'packages/kit/src/money/shadowed.ts': "export { taxOf as shadowed } from './shadow.js';\n",
      'packages/kit/src/money/clash.ts': "export { taxOf as clash } from './both.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'uses', '--name', 'deep'])).out).toContain(`at packages/kit/src/money/deep.ts:1, ${DECLARED}, `);
    expect((await run(['ask', 'uses', '--name', 'shadowed'])).out).toContain(`at packages/kit/src/money/shadowed.ts:1, ${DECLARED}, `);
    const clash = await run(['ask', 'uses', '--name', 'clash']);
    expect(clash.code).toBe(EXIT_CLEAN);
    expect(clash.out).toContain('packages/kit/src/money/clash.ts:1');
    expect(clash.out).not.toContain('passes on');
  });

  it('lets a named export decide even when it reaches nothing, and carries an ambiguous star upward', async () => {
    checkout({
      'packages/kit/src/money/empty.ts': 'export const nothing = 1;\n',
      'packages/kit/src/money/decides.ts': "export * from './tax.js';\nexport { taxOf } from './empty.js';\n",
      'packages/kit/src/money/other.ts': 'export function taxOf(): number {\n  return 0;\n}\n',
      'packages/kit/src/money/third.ts': 'export function taxOf(): number {\n  return 3;\n}\n',
      'packages/kit/src/money/both.ts': "export * from './tax.js';\nexport * from './other.js';\n",
      'packages/kit/src/money/upper.ts': "export * from './both.js';\nexport * from './third.js';\n",
      'packages/kit/src/money/decided.ts': "export { taxOf as decided } from './decides.js';\n",
      'packages/kit/src/money/carried.ts': "export { taxOf as carried } from './upper.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const name of ['decided', 'carried']) {
      const { code, out } = await run(['ask', 'uses', '--name', name]);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain(`packages/kit/src/money/${name}.ts:1`);
      expect(out).not.toContain('passes on');
    }
  });

  it("lets a file's own export of the name decide before its stars", async () => {
    checkout({
      'packages/kit/src/money/inner.ts': "function inner(): number {\n  return 2;\n}\nexport { inner as taxOf };\nexport * from './tax.js';\n",
      'packages/kit/src/money/own.ts': "export { taxOf as own } from './inner.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'uses', '--name', 'own'])).out)
      .toContain('at packages/kit/src/money/own.ts:1, which passes on `inner`, declared at packages/kit/src/money/inner.ts:1, ');
  });

  it('passes over a declaration of the name its file does not export', async () => {
    checkout({
      'packages/kit/src/money/hidden.ts': "const taxOf = 0;\nexport * from './tax.js';\n",
      'packages/kit/src/money/unexported.ts': "export { taxOf as unexported } from './hidden.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'uses', '--name', 'unexported'])).out).toContain(`at packages/kit/src/money/unexported.ts:1, ${DECLARED}, `);
  });

  it('names no declaration for a namespace, though a star declares the name', async () => {
    checkout({
      'packages/kit/src/money/levied.ts': 'export function levy(): number {\n  return 1;\n}\n',
      'packages/kit/src/money/spaced.ts': "export * as levy from './tax.js';\nexport * from './levied.js';\n",
      'packages/kit/src/money/spacing.ts': "export { levy as spacing } from './spaced.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const spacing = await run(['ask', 'uses', '--name', 'spacing']);
    expect(spacing.code).toBe(EXIT_CLEAN);
    expect(spacing.out).toContain('packages/kit/src/money/spacing.ts:1');
    expect(spacing.out).not.toContain('passes on');
  });

  it('follows an import the file exports again, and names none for a namespace it exports', async () => {
    checkout({
      'packages/kit/src/money/imported.ts': "import { taxOf } from './tax.js';\nexport { taxOf as imported };\n",
      'packages/kit/src/money/further.ts': "export { imported as further } from './imported.js';\n",
      'packages/kit/src/money/wholly.ts': "import * as tax from './tax.js';\nexport { tax as wholly };\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const imported = (await run(['ask', 'uses', '--name', 'imported'])).out;
    expect(imported).toContain('at packages/kit/src/money/imported.ts:');
    expect(imported).toContain(`, ${DECLARED}, `);
    expect((await run(['ask', 'uses', '--name', 'further'])).out).toContain(`at packages/kit/src/money/further.ts:1, ${DECLARED}, `);
    const wholly = await run(['ask', 'uses', '--name', 'wholly']);
    expect(wholly.code).toBe(EXIT_CLEAN);
    expect(wholly.out).toContain('packages/kit/src/money/wholly.ts:');
    expect(wholly.out).not.toContain('passes on');
  });

  it('follows `default` passed on by name, and never through a star', async () => {
    checkout({
      'packages/kit/src/money/defaulted.ts': 'export default function rated(amount: number): number {\n  return amount;\n}\n',
      'packages/kit/src/money/named.ts': "export { default as named } from './defaulted.js';\n",
      'packages/kit/src/money/starred.ts': "export * from './defaulted.js';\n",
      'packages/kit/src/money/unstarred.ts': "export { default as unstarred } from './starred.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'uses', '--name', 'named'])).out)
      .toContain('at packages/kit/src/money/named.ts:1, which passes on `rated`, declared at packages/kit/src/money/defaulted.ts:1, ');
    const unstarred = await run(['ask', 'uses', '--name', 'unstarred']);
    expect(unstarred.code).toBe(EXIT_CLEAN);
    expect(unstarred.out).toContain('packages/kit/src/money/unstarred.ts:1');
    expect(unstarred.out).not.toContain('passes on');
  });

  it('names no declaration when the files only pass the name to each other', async () => {
    checkout({
      'packages/kit/src/money/left.ts': "export { loop } from './right.js';\n",
      'packages/kit/src/money/right.ts': "export { loop } from './left.js';\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const verb of ['uses', 'symbol']) {
      const { code, out } = await run(['ask', verb, '--name', 'loop']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('packages/kit/src/money/left.ts:1');
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
