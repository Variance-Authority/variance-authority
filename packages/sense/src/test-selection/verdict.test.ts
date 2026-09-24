import { describe, expect, it } from 'vitest';
import { native, nativeAvailable } from '../native.js';

/**
 * The verdict the addon gives one file from its two texts, asked directly.
 *
 * Each case is an edit whose effect at runtime is known, and the verdict it
 * must not be read below: an edit that changes what runs is never `none`, one
 * that changes what the module does as it loads is `load`.
 */

const verdictOf = (before: string, after: string) => native()!.moduleVerdict!('src/store.ts', before, after);

describe.runIf(nativeAvailable())('a module verdict', () => {
  it('reads a changed member of a `const` enum as what the module runs as it loads', () => {
    // A runner that compiles one file at a time emits the enum as an object
    // built at load, so its members are not erased.
    const before = 'export const enum Mode { Idle = 0, Busy = 1 }\n';
    expect(verdictOf(before, before.replace('Busy = 1', 'Busy = 2'))?.kind).toBe('load');
  });

  it('reads a `declare` enum as a type, which runs nothing', () => {
    const before = 'export declare enum Mode { Idle = 0, Busy = 1 }\n';
    expect(verdictOf(before, before.replace('Busy = 1', 'Busy = 2'))?.kind).toBe('none');
  });

  it('reads a method added to a class as a moved class', () => {
    const before = 'export class Store {\n  get(): number {\n    return 1;\n  }\n}\n';
    const after = before.replace('  get(', '  reset(): void {}\n  get(');
    expect(verdictOf(before, after)).toMatchObject({ kind: 'values', names: ['Store'] });
    // `exports` is a name bound to something else; a value that moved under its
    // own name reaches importers through the readers.
    const readers = native()!.moduleReaders!('src/store.ts', after, ['Store'], false);
    expect(readers?.exported).toEqual([{ name: 'Store', origin: 'Store' }]);
  });

  it('reads an edit inside a method as a body', () => {
    const before = 'export class Store {\n  get(): number {\n    return 1;\n  }\n}\n';
    expect(verdictOf(before, before.replace('return 1', 'return 2'))).toMatchObject({ kind: 'bodies', names: [] });
  });

  it('reads two declarations reordered so one reads the other before it exists as load', () => {
    const before = 'const LIMIT = 10;\nconst DOUBLE = LIMIT * 2;\nexport { DOUBLE };\n';
    const after = 'const DOUBLE = LIMIT * 2;\nconst LIMIT = 10;\nexport { DOUBLE };\n';
    expect(verdictOf(before, after)?.kind).toBe('load');
  });

  it('reads an import that binds nothing as load', () => {
    const before = "import { clamp } from './limits';\nexport const f = () => clamp(1);\n";
    expect(verdictOf(before, `import './polyfill';\n${before}`)?.kind).toBe('load');
  });

  it('names a source an import starts binding from, for its package to answer', () => {
    const before = "import { clamp } from './limits';\nexport const f = () => clamp(1);\n";
    const after = "import { clamp } from './limits';\nimport { wrap } from './wrap';\nexport const f = () => wrap(clamp(1));\n";
    expect(verdictOf(before, after)).toMatchObject({ kind: 'bodies', imported: ['./wrap'] });
    expect(verdictOf(after, before)).toMatchObject({ kind: 'bodies', imported: ['./wrap'] });
  });

  it('reads a name added to an import as nothing the module does while it loads', () => {
    const before = "import { clamp } from './limits';\nexport const f = () => clamp(1);\n";
    const after = "import { clamp, STEP } from './limits';\nexport const f = () => clamp(STEP);\n";
    expect(verdictOf(before, after)).toMatchObject({ kind: 'bodies', imported: [] });
  });

  it('names a new export among the exports that moved', () => {
    const before = 'export function clamp(value: number): number {\n  return value;\n}\n';
    const after = `${before}export function wrap(value: number): number {\n  return value % 7;\n}\n`;
    expect(verdictOf(before, after)).toMatchObject({ kind: 'values', exports: ['wrap'] });
  });
});
