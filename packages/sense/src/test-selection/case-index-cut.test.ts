import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { casesCutApart } from './case-index-cut.js';
import { encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';

/** One module, cut with its two functions at `lines`. */
function module(file: string, lines: { readonly applyDiscount: readonly [number, number]; readonly round: readonly [number, number] }): TestCoverage['modules'][number] {
  return {
    file,
    sourceDigest: `source:${file}`,
    instrumented: true,
    blocks: (['applyDiscount', 'round'] as const).map((name, ordinal) => ({
      ordinal,
      kind: 'function' as const,
      digest: `block:${file}:${name}`,
      name,
      path: name,
      startLine: lines[name][0],
      endLine: lines[name][1],
      source: true,
      testFiles: ['test/total.test.ts'],
    })),
  };
}

function indexed(file: string, lines: { readonly applyDiscount: readonly [number, number]; readonly round: readonly [number, number] }) {
  return {
    file,
    blocks: (['applyDiscount', 'round'] as const).map((name) => ({ kind: 'function' as const, name, path: name, startLine: lines[name][0], endLine: lines[name][1] })),
  };
}

/** `of` with the region named `name` written by a transform with no line of its own. */
function placeless(of: TestCoverage['modules'][number], name: string): TestCoverage['modules'][number] {
  return {
    ...of,
    blocks: of.blocks.map((block) => {
      if (block.name !== name) return block;
      const { startLine: _startLine, endLine: _endLine, ...rest } = block;
      return rest;
    }),
  };
}

const BASE = { applyDiscount: [1, 3], round: [5, 7] } as const;
const LEAD = { applyDiscount: [2, 4], round: [6, 8] } as const;

describe('a case index read beside the snapshot it was recorded with', () => {
  const dir = mkdtempSync(join(tmpdir(), 'case-index-cut-'));
  const record = join(dir, 'coverage.bin');
  // The snapshot re-cut to a text with a line before both functions.
  writeFileSync(record, encodeTestCoverage({
    version: 3,
    instrumentation: 'fixture',
    commit: 'a'.repeat(40),
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    modules: [module('src/moved.ts', LEAD), module('src/still.ts', LEAD), placeless(module('src/written.ts', LEAD), 'applyDiscount'), module('src/renamed.ts', LEAD)],
  }));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names a file whose index stands at the lines of the text before', () => {
    expect([...casesCutApart(record, [indexed('src/moved.ts', BASE), indexed('src/still.ts', LEAD)])]).toEqual(['src/moved.ts']);
  });

  it('does not name a file only by a region the snapshot holds no line for', () => {
    expect(casesCutApart(record, [indexed('src/written.ts', { applyDiscount: BASE.applyDiscount, round: LEAD.round })]).size).toBe(0);
  });

  it('names a file whose index holds regions and shares none with the snapshot', () => {
    const before = indexed('src/renamed.ts', BASE);
    const renamed = { file: before.file, blocks: before.blocks.map((block) => ({ ...block, name: `${block.name}Before`, path: `${block.path}Before` })) };
    expect([...casesCutApart(record, [renamed])]).toEqual(['src/renamed.ts']);
  });

  it('does not name a file whose index holds no region', () => {
    expect(casesCutApart(record, [{ file: 'src/renamed.ts', blocks: [] }]).size).toBe(0);
  });

  it('does not name a file the snapshot holds no row for', () => {
    expect(casesCutApart(record, [indexed('src/absent.ts', BASE)]).size).toBe(0);
  });

  it('reads nothing when it is asked of no module', () => {
    expect(casesCutApart(join(dir, 'absent.bin'), []).size).toBe(0);
  });
});
