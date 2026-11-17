import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as sense from '@variance-authority/sense';
import type { SourceNames } from './names.js';
import { readTree } from './tree.js';

vi.mock('@variance-authority/sense', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense')>();
  return { ...actual, scanRelations: vi.fn(actual.scanRelations), runGraphOf: vi.fn(actual.runGraphOf), openSourceIndex: vi.fn(actual.openSourceIndex) };
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

  it("queries matching evidence without reconstructing every file's names", async () => {
    let drawn: SourceNames | undefined;
    const tree = await readTree({ root, names: (names) => { drawn = names; } });
    expect(sense.scanRelations).not.toHaveBeenCalled();
    expect(sense.runGraphOf).not.toHaveBeenCalled();
    expect(sense.openSourceIndex).not.toHaveBeenCalled();
    expect(tree.files).toContain('src/theme.ts');
    const answer = drawn!.query([
      { kind: 'declares', pattern: '^ThemeContext$' },
      { kind: 'imports', specifier: 'react', name: 'createContext' },
      { kind: 'imports', specifier: 'src/theme.ts', name: 'ThemeContext' },
    ]);
    expect(answer.unread).toBe(0);
    expect(answer.groups[0]!.files).toEqual([{ file: 'src/theme.ts', evidence: [{ name: 'ThemeContext', line: 2 }] }]);
    expect(answer.groups[1]!.files).toEqual([{ file: 'src/theme.ts', evidence: [{ from: 'react', name: 'createContext', line: 1 }] }]);
    expect(answer.groups[2]!.files).toContainEqual({ file: 'src/entry.ts', evidence: [{ from: './theme', name: 'ThemeContext', line: 1 }] });
  });

  it('declares no forwarded import or nested symbol, and a default once under its own name', async () => {
    let drawn: SourceNames | undefined;
    await readTree({ root, names: (names) => { drawn = names; } });
    const answer = drawn!.query([{ kind: 'declares', pattern: '.' }]);
    expect(answer.groups[0]!.files).toEqual([
      { file: 'src/closure.ts', evidence: [{ name: 'run', line: 2 }] },
      { file: 'src/entry.ts', evidence: [{ name: 'read', line: 2 }] },
      { file: 'src/made.ts', evidence: [{ name: 'make', line: 1 }] },
      { file: 'src/theme.ts', evidence: [{ name: 'ThemeContext', line: 2 }] },
    ]);
  });

  it('uses Rust regex syntax and preserves the declaration context in refusals', async () => {
    let drawn: SourceNames | undefined;
    await readTree({ root, names: (names) => { drawn = names; } });
    expect(() => drawn!.query([{ kind: 'declares', pattern: '(?=Theme)' }])).toThrow('`declares` is not a regular expression');
  });
});
