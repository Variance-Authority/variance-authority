import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { nativeAvailable } from '../addon.js';
import type { InstrumentMode } from './blocks.js';
import { instrument } from './index.js';
import { splicedInJs, splicedNatively, type Spliced } from './spliced.js';

/**
 * The addon's walk against the JavaScript one, over every source there is.
 *
 * The native walk is allowed to be a different program and not a different
 * answer: a block numbered differently under the same instrumentation id is a
 * recording that attributes one region's arrivals to another, and nothing
 * downstream could tell. So this compares whole results — code, header offset,
 * every block field — rather than asserting what either should have produced.
 */

const available = nativeAvailable();
const MODES: readonly InstrumentMode[] = ['presence', 'entries'];

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
const corpus = execFileSync(
  'git',
  ['ls-files', '-z', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.mts', '*.cts'],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  },
)
  .split('\0')
  .filter((file) => file !== '' && !file.endsWith('.d.ts'));

/** What a hand-written corpus has that this repository's sources may not. */
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
};

function compare(sources: Iterable<readonly [string, string]>): {
  readonly differing: string[];
  readonly declined: string[];
  readonly compared: number;
} {
  const differing: string[] = [];
  const declined: string[] = [];
  let compared = 0;
  for (const [file, source] of sources) {
    for (const mode of MODES) {
      const oracle = splicedInJs(source, file, mode);
      const answered = splicedNatively(source, file, mode);
      if (answered === undefined) {
        if (oracle !== undefined) declined.push(`${file} (${mode})`);
        continue;
      }
      compared++;
      const difference = firstDifference(oracle, answered);
      if (difference !== undefined) differing.push(`${file} (${mode}): ${difference}`);
    }
  }
  return { differing, declined, compared };
}

function firstDifference(oracle: Spliced | undefined, answered: Spliced): string | undefined {
  if (oracle === undefined) return 'the addon answered a source the JavaScript walk refused';
  if (oracle.code !== answered.code) {
    let at = 0;
    while (oracle.code[at] === answered.code[at]) at++;
    return `code at ${at}: ${JSON.stringify(oracle.code.slice(at, at + 60))} vs ${JSON.stringify(answered.code.slice(at, at + 60))}`;
  }
  if (oracle.headerAt !== answered.headerAt)
    return `headerAt ${oracle.headerAt} vs ${answered.headerAt}`;
  if (oracle.sourceDigest !== answered.sourceDigest) return 'sourceDigest';
  if (oracle.blocks.length !== answered.blocks.length) {
    return `${oracle.blocks.length} blocks vs ${answered.blocks.length}`;
  }
  for (let ordinal = 0; ordinal < oracle.blocks.length; ordinal++) {
    const [left, right] = [oracle.blocks[ordinal]!, answered.blocks[ordinal]!];
    for (const key of [
      'ordinal',
      'kind',
      'owner',
      'digest',
      'name',
      'path',
      'start',
      'end',
    ] as const) {
      if (left[key] !== right[key]) {
        return `block ${ordinal} ${key}: ${JSON.stringify(left[key])} vs ${JSON.stringify(right[key])}`;
      }
    }
  }
  return undefined;
}

describe('the native instrument against the JavaScript one', () => {
  it.runIf(available)('agrees on every source this repository tracks', () => {
    const { differing, declined, compared } = compare(
      corpus.map((file) => [file, readFileSync(join(root, file), 'utf8')] as const),
    );

    expect(differing).toEqual([]);
    expect(declined).toEqual([]);
    expect(compared).toBeGreaterThan(corpus.length);
  });

  it.runIf(available)('agrees on what a repository of its own would not hold', () => {
    const { differing, declined } = compare(Object.entries(FIXTURES));

    expect(differing).toEqual([]);
    // A name only JavaScript can spell is declined rather than guessed.
    expect(declined).toEqual(['regexp-key.js (presence)', 'regexp-key.js (entries)']);
  });

  it.runIf(available)('leaves a source with a lone surrogate to the JavaScript walk', () => {
    const source = 'const a = "\uD800";\nif (a) b();\n';

    expect(splicedNatively(source, 'lone.js', 'presence')).toBeUndefined();
    expect(splicedInJs(source, 'lone.js', 'presence')).toBeDefined();
  });
});

describe('the header', () => {
  it.each(['await-first.js', 'await-after-import.js'])(
    'declares the runtime in front of a first statement that opens with a probe: %s',
    (file) => {
      const code = instrument(FIXTURES[file]!, file)!.code;
      const statements = parseSync(file, code).program.body as readonly {
        type: string;
        id?: { name: string };
      }[];
      const first = statements.findIndex((statement) => statement.type !== 'ImportDeclaration');

      expect(statements[first]).toMatchObject({
        type: 'FunctionDeclaration',
        id: { name: '__va' },
      });
    },
  );
});
