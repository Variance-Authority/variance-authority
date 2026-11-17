import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { NativeGitTree } from './native.js';

const { declaredTsconfig, declaresWorkspaces } = vi.hoisted(() => ({
  declaredTsconfig: vi.fn().mockReturnValue(false),
  declaresWorkspaces: vi.fn().mockReturnValue(true),
}));
vi.mock('./typescript.js', () => ({ declaredTsconfig }));
vi.mock('@variance-authority/package', () => ({ declaresWorkspaces }));

import { prepareCodeMap } from './code-map.js';

it('uses the canonical checkout root throughout a carried map preparation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sense-map-root-'));
  const root = join(directory, 'linked-checkout');
  const canonical = realpathSync.native(directory);
  symlinkSync(directory, root, 'dir');
  const index = join(canonical, 'index.bin');
  const prepareOrientMap = vi.fn().mockResolvedValue(null);
  const listing = { prepareOrientMap } as unknown as NativeGitTree;
  try {
    await expect(prepareCodeMap(root, index, { listing })).resolves.toEqual({ index });

    expect(prepareOrientMap).toHaveBeenCalledExactlyOnceWith(canonical, index, true, false, undefined);
    expect(declaredTsconfig).toHaveBeenCalledExactlyOnceWith(canonical);
    expect(declaresWorkspaces).toHaveBeenCalledExactlyOnceWith(canonical);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
