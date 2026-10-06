import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { native, nativeAvailable } from '../native.js';
import { importReferences } from './references.js';

/**
 * Where a file references what it imports, asked of the addon directly: each
 * reference by the specifier its import names, and whether it runs when the
 * file loads. A reference is an evaluation, where an inline `require` would
 * load the module, so a value passed on or stored is referenced and a type is
 * not.
 */

const referencesOf = (file: string, text: string) => native()!.moduleReferences!(file, text);

describe.runIf(nativeAvailable())('the references of what a file imports', () => {
  it('places each reference by its source, at load or inside a function, and leaves out every type', () => {
    const text = [
      "import { PDFDocument } from 'pdf-lib';",
      "import { format } from 'date-fns';",
      "import * as icons from './icons';",
      "import Modal from './Modal';",
      "import './polyfill';",
      "import type { Props } from './types';",
      "import { type Shape, value } from './shapes';",
      'const views = { modal: Modal };',
      "export const formatDate = (d: Date) => format(d, 'P');",
      'export function exportPdf(p: Props): Shape { return PDFDocument.create(); }',
      'export function icon() { return icons.check; }',
      'export { value, views };',
      'export const all = () => icons;',
      "import { type Only } from './only';",
      '',
    ].join('\n');
    expect(referencesOf('src/utils.ts', text)).toEqual({
      references: [
        { source: './Modal', name: 'default', line: 8, load: true },
        { source: 'date-fns', name: 'format', line: 9, load: false },
        { source: 'pdf-lib', name: 'PDFDocument', line: 10, load: false },
        { source: './icons', name: 'check', line: 11, load: false },
        { source: './icons', name: '*', line: 13, load: false },
      ],
      passed: [{ source: './shapes', name: 'value' }],
      sources: ['./Modal', './icons', './only', './polyfill', './shapes', 'date-fns', 'pdf-lib'],
      effects: ['./polyfill'],
      untraced: false,
    });
  });

  it('charges a name two sources export to the import whose local name the file references', () => {
    const text = [
      "import { create } from 'left';",
      "import { create as make } from 'right';",
      'export const build = () => make();',
      '',
    ].join('\n');
    expect(referencesOf('src/build.ts', text)?.references).toEqual([
      { source: 'right', name: 'create', line: 3, load: false },
    ]);
  });

  it('reads no reference in an annotation, a `typeof` type, an `implements` clause or an `as` type', () => {
    const text = [
      "import { Store } from './store';",
      'export function read(store: Store): typeof Store { return null as unknown as typeof Store; }',
      'export class Local implements Store {}',
      'export interface Wrapped extends Store {}',
      'export type Alias = Store;',
      '',
    ].join('\n');
    expect(referencesOf('src/read.ts', text)?.references).toEqual([]);
  });

  it('hands on a re-export by its source, and says a `require` no name traces', () => {
    const text = [
      "export { a } from './a';",
      "export * from './b';",
      "export const late = () => require('./c');",
      '',
    ].join('\n');
    expect(referencesOf('src/index.ts', text)).toEqual({
      references: [],
      passed: [
        { source: './a', name: 'a' },
        { source: './b', name: '*' },
      ],
      sources: ['./a', './b'],
      effects: [],
      untraced: true,
    });
  });

  it('lands each source on a file of the checkout, and leaves out one it cannot find', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-authority-references-'));
    try {
      const files: Record<string, string> = {
        'src/index.ts': [
          "import { a } from './a';",
          "import './c';",
          "import { gone } from './gone';",
          "export * from './b';",
          'export const f = () => [a, gone];',
          '',
        ].join('\n'),
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 1;\n',
        'src/c.ts': 'globalThis.c = 1;\n',
      };
      for (const [file, body] of Object.entries(files)) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), body);
      }
      expect(importReferences(root, undefined, 'src/index.ts')).toEqual({
        references: [{ file: 'src/a.ts', name: 'a', line: 5, load: false }],
        passed: ['src/b.ts'],
        imported: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        effects: ['src/c.ts'],
        untraced: false,
      });
      expect(importReferences(root, undefined, 'src/missing.ts')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
