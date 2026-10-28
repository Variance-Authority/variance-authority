import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Parsed } from '@variance-authority/sense';
import { namesOf, type SourceNames } from './names.js';
import { readTree } from './tree.js';

/**
 * What a file declares and what it imports, read off one parse. A declaration is
 * this file's own: a name it forwards with `export { x } from` is declared by
 * the file it forwards from, so it is not here.
 */

const PARSED: Parsed = {
  requests: [
    {
      value: 'react',
      kind: 'imports',
      line: 1,
      bindings: [
        { imported: 'createContext', local: 'createContext', type: false, line: 1 },
        { imported: 'useContext', local: 'read', type: false, line: 1 },
      ],
    },
    { value: './theme', kind: 'imports', line: 2, bindings: [{ imported: '*', local: 'theme', type: false, line: 2 }] },
    { value: './side-effect.css', kind: 'imports', line: 3, bindings: [] },
    { value: './forwarded', kind: 'imports', line: 9, bindings: [] },
    { value: './store', kind: 'imports', line: 4, bindings: [{ imported: 'selectBalance', local: 'selectBalance', type: false, line: 4 }] },
  ],
  members: [{ request: 1, name: 'dark', line: 6 }],
  symbols: [
    { name: 'ThemeContext', kind: 'const', line: 5 },
    { name: 'useTheme', kind: 'function', line: 7 },
  ],
  exports: [
    { exported: 'ThemeContext', line: 5 },
    { exported: 'useTheme', line: 7 },
    { exported: 'Palette', line: 8 },
    { exported: 'Forwarded', from: './forwarded', line: 9 },
    { exported: 'default', local: 'selectBalance', line: 10 },
  ],
} as unknown as Parsed;

describe('namesOf', () => {
  const names = namesOf(PARSED, ['node_modules/react/index.js', 'src/theme.ts', 'src/side-effect.css', 'src/forwarded.ts', 'src/store.ts']);

  it('declares its own symbols and exports once each, never a forwarded or re-exported import', () => {
    expect(names.declared).toEqual([
      { name: 'ThemeContext', line: 5 },
      { name: 'useTheme', line: 7 },
      { name: 'Palette', line: 8 },
    ]);
  });

  it('imports each binding under the name its module publishes, and each member read off a namespace', () => {
    expect(names.imported).toContainEqual({ from: 'react', to: 'node_modules/react/index.js', name: 'createContext', line: 1 });
    expect(names.imported).toContainEqual({ from: 'react', to: 'node_modules/react/index.js', name: 'useContext', local: 'read', line: 1 });
    expect(names.imported).toContainEqual({ from: './theme', to: 'src/theme.ts', name: 'dark', line: 6, through: 'theme' });
  });

  it('imports a module that binds nothing, so a side effect is still an import of it', () => {
    expect(names.imported).toContainEqual({ from: './side-effect.css', to: 'src/side-effect.css', line: 3 });
  });
});

describe('readTree draws the names with the tree when asked', () => {
  let root: string;
  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'names-'));
    write('package.json', '{"name":"names-fixture","private":true}\n');
    write('src/entry.ts', "import { ThemeContext } from './theme';\nexport const read = ThemeContext;\n");
    write('src/theme.ts', "import { createContext } from 'react';\nexport const ThemeContext = createContext(0);\n");
    write('src/passed.ts', "import { ThemeContext } from './theme';\nexport default ThemeContext;\nexport { ThemeContext as Renamed };\n");
    write('src/made.ts', 'export default function make() {}\n');
    write('src/spaced.ts', "import * as theme from './theme';\nexport { theme };\n");
    write('src/closure.ts', "import { ThemeContext } from './theme';\nexport function run() {\n  const ThemeContext = () => 0;\n  const step = () => ThemeContext();\n  return step();\n}\nexport { ThemeContext };\n");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('hands every file its names, keyed as the tree keys it', async () => {
    let drawn: SourceNames | undefined;
    const tree = await readTree({ root, names: (names) => { drawn = names; } });
    expect(tree.files).toContain('src/theme.ts');
    expect(drawn?.get('src/theme.ts')?.declared).toEqual([{ name: 'ThemeContext', line: 2 }]);
    expect(drawn?.get('src/theme.ts')?.imported).toContainEqual(expect.objectContaining({ from: 'react', name: 'createContext', line: 1 }));
    expect(drawn?.get('src/entry.ts')?.imported).toContainEqual(expect.objectContaining({ from: './theme', to: 'src/theme.ts', name: 'ThemeContext' }));
  });

  it('declares no export of an imported name, and a default declaration once, under its own name', async () => {
    let drawn: SourceNames | undefined;
    await readTree({ root, names: (names) => { drawn = names; } });
    expect(drawn?.get('src/passed.ts')?.declared).toEqual([]);
    expect(drawn?.get('src/made.ts')?.declared).toEqual([{ name: 'make', line: 1 }]);
    expect(drawn?.get('src/spaced.ts')?.declared).toEqual([]);
  });

  it('declares what a file declares at its top level, never what a function body declares', async () => {
    let drawn: SourceNames | undefined;
    await readTree({ root, names: (names) => { drawn = names; } });
    expect(drawn?.get('src/closure.ts')?.declared).toEqual([{ name: 'run', line: 2 }]);
  });
});
