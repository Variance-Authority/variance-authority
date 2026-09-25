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

  describe('a type in a decorated class, which `emitDecoratorMetadata` emits', () => {
    const service = (injected: string) =>
      `@Injectable()\nexport class Checkout {\n  constructor(private readonly prices: ${injected}) {}\n}\n`;

    it("reads a constructor parameter's type as load, because the class records it when it is defined", () => {
      expect(verdictOf(service('PriceService'), service('DiscountedPrices'))?.kind).toBe('load');
    });

    it("reads a decorated property's type as load", () => {
      const view = (type: string) => `export class View {\n  @Input() total: ${type};\n}\n`;
      expect(verdictOf(view('number'), view('string'))?.kind).toBe('load');
    });

    it('reads a changed parameter decorator as load, because it runs when the class is defined', () => {
      const before = 'export class Checkout {\n  constructor(@Inject(PRICES) prices: unknown) {}\n}\n';
      expect(verdictOf(before, before.replace('PRICES', 'DISCOUNTS'))?.kind).toBe('load');
    });

    it('reads a type inside a method body of a decorated class as nothing', () => {
      const before = '@Injectable()\nexport class Checkout {\n  total() {\n    const sum: number = 1;\n    return sum;\n  }\n}\n';
      expect(verdictOf(before, before.replace('sum: number', 'sum: 1'))?.kind).toBe('none');
    });

    it('reads a type in a class nothing decorates as nothing', () => {
      const plain = (injected: string) => `export class Checkout {\n  constructor(private readonly prices: ${injected}) {}\n}\n`;
      expect(verdictOf(plain('PriceService'), plain('DiscountedPrices'))?.kind).toBe('none');
    });
  });

  describe('a comment that sets a JSX pragma', () => {
    const view = (before: string, after: string) => native()!.moduleVerdict!('src/view.tsx', before, after);
    const body = 'export const View = () => <div />;\n';

    it('reads a changed import source as load, because the compiler imports the runtime from it', () => {
      const before = `/** @jsxImportSource react */\n${body}`;
      expect(view(before, before.replace('react', 'preact'))?.kind).toBe('load');
    });

    it('reads a pragma added in a line comment as load', () => {
      expect(view(body, `// @jsxRuntime classic\n${body}`)?.kind).toBe('load');
    });

    it('reads a changed factory as load, because every element is emitted as a call to it', () => {
      const before = `/* @jsx h */\nimport { h } from 'preact';\n${body}`;
      expect(view(before, before.replace('@jsx h', '@jsx createElement'))?.kind).toBe('load');
    });

    it('reads a comment edited around an unchanged pragma as nothing', () => {
      const before = `/** @jsxImportSource preact */\n${body}`;
      expect(view(before, `/**\n * The view.\n * @jsxImportSource preact\n */\n${body}`)?.kind).toBe('none');
    });
  });

  describe('the exports an importer sees move', () => {
    const before = [
      'const LIMIT = 10;',
      'function clamp(n: number) {\n  return Math.min(n, LIMIT);\n}',
      'export function total(n: number) {\n  return clamp(n) * 2;\n}',
      'export function label() {\n  return "cart";\n}',
      'export default function render() {\n  return label();\n}',
      '',
    ].join('\n');

    it('names every export that reaches a changed value through the bindings of the file', () => {
      expect(verdictOf(before, before.replace('= 10', '= 20'))?.moved).toEqual(['total']);
    });

    it('names the export whose helper changed inside its body, and none beside it', () => {
      expect(verdictOf(before, before.replace('Math.min', 'Math.max'))).toMatchObject({ kind: 'bodies', moved: ['total'] });
    });

    it('names a default export by `default`, and what calls into it', () => {
      expect(verdictOf(before, before.replace('"cart"', '"basket"'))?.moved).toEqual(['default', 'label']);
    });

    it('names nothing for a change nothing runs', () => {
      expect(verdictOf(before, `// the cart\n${before}`)?.moved).toEqual([]);
    });

    it('names every export when a statement hands a moved binding on as the module loads', () => {
      const handed = `${before}globalThis.clamp = clamp;\n`;
      expect(verdictOf(handed, handed.replace('Math.min', 'Math.max'))?.moved).toBeUndefined();
    });

    it('moves what reads a `let` that a changed function may write', () => {
      const state = 'let count = 0;\nexport function bump() {\n  count += 1;\n}\nexport function read() {\n  return count;\n}\nexport function name() {\n  return "n";\n}\n';
      expect(verdictOf(state, state.replace('+= 1', '+= 2'))?.moved).toEqual(['bump', 'read']);
    });
  });
});
