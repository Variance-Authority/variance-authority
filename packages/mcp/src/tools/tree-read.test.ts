import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTree } from './tree.js';

describe('readTree', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'tree-read-'));
    writeFileSync(join(root, 'package.json'), '{"name":"tree-read-fixture","private":true}\n');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('refuses an index it cannot write, rather than answering from the tree before the edit', async () => {
    await expect(readTree({ root, index: join(root, 'package.json', 'index') })).rejects.toThrow('package.json/index: Not a directory');
  });
});
