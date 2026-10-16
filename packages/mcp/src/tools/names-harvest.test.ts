import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SourceNames } from './names.js';
import { readTree } from './tree.js';

/**
 * A large checkout is read by the addon's graph in one call. A name a file
 * declares without exporting it is where a context is made, so the names hold
 * it, however the tree was read and whoever wrote the index it was read back
 * from.
 *
 * Ten thousand files is where the scan hands the tree to the graph.
 */

let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'names-harvest-'));
  write('package.json', '{"name":"names-harvest-fixture","private":true}\n');
  write('src/Nav.ts', "import { useTheme } from './theme';\nexport const nav = useTheme;\n");
  write('src/theme.ts', "const ThemeContext = { theme: 'light' };\nexport const useTheme = () => ThemeContext;\n");
  for (let n = 0; n < 10_000; n++) write(`src/many/m${n}.ts`, `export const m${n} = ${n};\n`);
  execFileSync('git', ['-C', root, 'init', '--quiet']);
  execFileSync('git', ['-C', root, 'add', '.']);
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function drawn(index?: string): Promise<SourceNames | undefined> {
  let names: SourceNames | undefined;
  await readTree({ root, ...(index === undefined ? {} : { index }), names: (read) => { names = read; } });
  return names;
}

describe('readTree over a checkout the graph reads', () => {
  it('declares what a file does not export', async () => {
    expect((await drawn())?.get('src/theme.ts')?.declared).toEqual([
      { name: 'ThemeContext', line: 1 },
      { name: 'useTheme', line: 2 },
    ]);
  }, 120_000);

  it('declares it when `variance index` wrote the rows the tree is read back from', async () => {
    const index = sourceIndexPath(root);
    rmSync(index, { force: true });
    await updateSourceIndex(root, { index });
    expect((await drawn(index))?.get('src/theme.ts')?.declared).toContainEqual({ name: 'ThemeContext', line: 1 });
  }, 120_000);
});
