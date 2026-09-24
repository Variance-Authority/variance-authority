import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { GOLDEN } from './__fixtures__/spliced-golden.js';
import { instrument } from './index.js';
import { spliced, type InstrumentMode } from './spliced.js';

/**
 * The walk against its committed answers.
 *
 * A block numbered differently under the same instrumentation id is a recording
 * that attributes one region's arrivals to another, and nothing downstream could
 * tell. So this compares whole results — code, header offset, every block
 * field — against [`spliced-golden.ts`](./__fixtures__/spliced-golden.ts). A
 * change there is a change to every recording's identity, and wants a new
 * instrumentation id beside it.
 */

const MODES: readonly InstrumentMode[] = ['presence', 'entries'];

/** What a hand-written corpus has that a repository's sources may not. */
const FIXTURES: Readonly<Record<string, string>> = {
  'unicode.ts':
    'const é = "ü😀";\nfunction naïve(x: string) { if (x) { return "日本" } return x }\nnaïve(é);\n',
  'bom.js': '﻿"use strict";\nif (a) b();\n',
  'directives.js':
    '#!/usr/bin/env node\n"use strict";\n"use client";\nimport a from "a";\nexport * from "b";\nexport { c } from "c";\nwhile (a) { a-- }\n',
  'hoisted.ts':
    'import { x } from "./x";\nvi.mock("./x");\nconst spy = vi.hoisted(() => 1);\njest["mock"]("./y");\nif (x) spy();\n',
  'overloads.ts':
    'export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a ? a : 0 }\ndeclare function g(): void;\n',
  'abstract.ts':
    'abstract class A { abstract m(): void; abstract p: number; n() { return 1 } constructor(private readonly q = () => 2) {} }\n',
  'decorators.ts':
    '// leading\n@dec export class C { @field x = () => 1; @m() method(@p a) { try { a() } catch { b() } finally { c() } } }\n',
  'namespaces.ts':
    'namespace N { export const f = () => { for (const a of b) { if (a) break } } }\nenum E { A = 1, B }\nmodule M.Q { function g() {} }\n',
  'jsx.tsx':
    'export const App = () => <div onClick={() => (x ? a() : b())}>{items.map((i) => <i key={i} />)}</div>;\n',
  'keys.js':
    'const o = { 1: () => 1, 0x10: () => 2, 1e21: function () {}, 1.5: () => 3, 10n: () => 4, "s": () => 5, [k]: () => 6, [a.b]: () => 7, [`t`]: () => 8, null: () => 9, true: () => 10 };\nclass K { #p = () => 1; static { if (a) b() } get g() { return 1 } set s(v) { if (v) c() } }\n',
  'comments.ts':
    '/* a */\n// b\n\nexport default class { m() { switch (a) { case 1: b(); case 2: { c() } default: d() } } }\n',
  'await-first.js': 'await a();\nx();\n',
  'await-after-import.js': 'import a from "a";\nawait a();\nx();\n',
  'loops.js':
    'label: for (let i = 0; i < 3; i++) { do { continue label } while (f()) }\nfor (const k in o) if (k) g();\nfor await (const x of y) z();\n',
  'functions.js':
    'export default function () { return async () => { await (async function named() { await 1 })() } }\nexport const h = function* () { yield 1 };\nnew Thing(() => 1, function () {});\na.b.c = () => 1;\nx ||= () => 2;\n',
  'empty.ts': '',
  'only-comment.ts': '// nothing\n',
  'directive-only.js': '"use strict";\n',
  'unknown.vue': 'export default { data() { return 1 } }\n',
  'broken.ts': 'if (',
  'regexp-key.js': 'const o = { [/x/]: () => 1 };\n',
  'lone-key.js': 'const o = { ["\\uD800x"]: () => 1, "\\uFFFD": () => 2 };\n',
};

describe('the walk', () => {
  it.each(Object.keys(FIXTURES).flatMap((file) => MODES.map((mode) => [file, mode] as const)))(
    'answers %s (%s) as committed',
    (file, mode) => {
      const answered = spliced(FIXTURES[file]!, file, mode);

      expect(answered === undefined ? null : { ...answered, blocks: answered.blocks.map((block) => ({ ...block })) })
        .toEqual(GOLDEN[`${file} (${mode})`]);
    },
  );

  it('spells a regular expression as `String(value)` does', () => {
    expect(spliced(FIXTURES['regexp-key.js']!, 'regexp-key.js', 'presence')!.blocks[1]!.name).toBe('/x/');
  });

  it('escapes a lone surrogate in a name, and keeps a replacement character', () => {
    const names = spliced(FIXTURES['lone-key.js']!, 'lone-key.js', 'presence')!.blocks.map((block) => block.name);

    expect(names).toEqual(['', '\\uD800x', '\uFFFD']);
  });

  it('leaves a source holding a lone surrogate uninstrumented', () => {
    expect(spliced('const a = "\uD800";\nif (a) b();\n', 'lone.js', 'presence')).toBeUndefined();
  });
});

describe('the header', () => {
  it.each(['await-first.js', 'await-after-import.js'])(
    'declares the runtime in front of a first statement that opens with a probe: %s',
    (file) => {
      const code = instrument(FIXTURES[file]!, file)!.code;
      const statements = parseSync(file, code).program.body as readonly {
        type: string;
        declarations?: readonly { id: { name: string } }[];
      }[];
      const first = statements.findIndex((statement) => statement.type !== 'ImportDeclaration');

      expect(statements[first]).toMatchObject({
        type: 'VariableDeclaration',
        declarations: [{ id: { name: '__vaK' } }, {}, {}, {}],
      });
    },
  );
});
