import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intersectionSource } from './ask-source.js';

/**
 * `variance ask intersection` reads its names from the checkout, through the
 * source index. An ask that finds every file already in the index must still
 * have their names: a file the index serves is not a file that declares
 * nothing.
 */

let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ask-intersection-'));
  write('package.json', '{"name":"ask-intersection-fixture","private":true}\n');
  write('src/Wallet.ts', "import { selectBalance } from './store';\nexport const balance = selectBalance;\n");
  write('src/store/index.ts', "import { selectBalance } from './selectors';\nexport { selectBalance };\n");
  write('src/store/selectors.ts', 'export const selectBalance = (state: { balance: number }) => state.balance;\n');
  write('src/old/selectors.ts', 'export const selectBalance = () => 0;\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = async (): Promise<string> =>
  (await intersectionSource(root, { declares: '^selectBalance$', from: ['src/Wallet.ts'] })).answer();

describe('ask intersection over a checkout', () => {
  it('finds the declaration a file can reach, among every file declaring the name, past the barrel that re-exports it', async () => {
    const text = await ask();
    expect(text).toContain('2 files declaring a name matching /^selectBalance$/i');
    expect(text).toContain('src/store/selectors.ts:1  declares selectBalance');
    expect(text).not.toContain('src/old/selectors.ts');
    expect(text).not.toContain('src/store/index.ts');
  });

  it('answers the same when every file is read back from the source index', async () => {
    rmSync(sourceIndexPath(root), { force: true });
    const parsed = await ask();
    expect(existsSync(sourceIndexPath(root))).toBe(true);
    const held = await ask();
    expect(held).toContain('src/store/selectors.ts:1  declares selectBalance');
    expect(held).toBe(parsed);
  });
});
