import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` names the kind of the declaration an export binds, as the
 * source index holds it, beside the name in the export heading: the same kind
 * a kept declaration's line prints, so the two never disagree.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-export-kind-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('variance ask uses names the kind of the declaration an export binds', () => {
  it('names it for an export that no entry publishes, imported or not', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const imported = await run(['ask', 'uses', '--name', 'addTax']);
    expect(imported.code).toBe(EXIT_CLEAN);
    expect(imported.out).toContain('`addTax` [function] is imported in 1 place, and no entry publishes it;');

    const orphan = await run(['ask', 'uses', '--name', 'orphan']);
    expect(orphan.code).toBe(EXIT_CLEAN);
    expect(orphan.out).toContain('`orphan` [variable] is exported, without being published, at packages/kit/src/orphan.ts:1');
  });

  it('names it for a published name', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`greet` [function] is imported in');
  });
});
