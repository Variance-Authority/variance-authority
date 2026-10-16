import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { dependents } from './dependents.js';

/**
 * What rests on a file, read off records so the walk is the rule and not a scan.
 *
 * `far.ts` reaches the subject only through `typed.ts`, which imports it for
 * types alone: walked, and said on the step. `blind.ts` has an import nothing
 * resolved and reaches nothing the graph can see, so the answer names it as a
 * file that may reach the subject unseen.
 */

const RECORDS: readonly FileRecord[] = [
  { file: 'src/subject.ts' },
  { file: 'src/a.ts', edges: [{ to: 'src/subject.ts', kind: 'imports' }] },
  { file: 'src/typed.ts', edges: [{ to: 'src/subject.ts', kind: 'type' }] },
  { file: 'src/b.ts', edges: [{ to: 'src/a.ts', kind: 'imports' }] },
  { file: 'src/far.ts', edges: [{ to: 'src/typed.ts', kind: 'imports' }] },
  { file: 'src/outside.ts' },
  { file: 'src/blind.ts', unknown: "`./gone` resolved to nothing" },
];

const tree = treeOf(RECORDS);
const HELP = {} as Help;
const ask = (input: Record<string, unknown>): string => dependents.run(HELP, input, { tree });

describe('dependents of a file', () => {
  it('lists every file that reaches it, nearest first, each with one shortest chain', () => {
    const text = ask({ file: 'src/subject.ts' });
    expect(text).toContain('4 files reach `src/subject.ts` through their imports');
    expect(text).toContain('1 import away:\nsrc/a.ts\nsrc/typed.ts (type import)');
    expect(text).toContain('2 imports away:\nsrc/b.ts → src/a.ts → src/subject.ts\nsrc/far.ts → src/typed.ts (type import) → src/subject.ts');
    expect(text).not.toContain('outside.ts');
  });

  it('counts the rows the limit leaves out, and how far the farthest is', () => {
    expect(ask({ file: 'src/subject.ts', limit: 1 })).toContain('3 more files not shown, the farthest 2 imports away; a higher `limit` shows them.');
  });

  it('names the files whose imports the scan could not read, as ones that may reach it unseen', () => {
    expect(ask({ file: 'src/subject.ts' })).toContain('1 file in the tree has an import the scan could not resolve, and may reach `src/subject.ts` through it: src/blind.ts.');
  });

  it('says nothing reaches a file nothing imports', () => {
    expect(ask({ file: 'src/outside.ts' })).toContain('Nothing reaches `src/outside.ts` through its imports.');
  });

  it('answers the files as a set, the subject left out', () => {
    expect([...dependents.files!(HELP, { file: 'src/subject.ts' }, { tree }).files.keys()]).toEqual(['src/a.ts', 'src/typed.ts', 'src/b.ts', 'src/far.ts']);
  });
});

describe('dependents refuses', () => {
  it('without a subject', () => {
    expect(() => ask({})).toThrow('`dependents` needs a subject: `file`, a path from the root, or `name`, an exported name.');
  });

  it('with two subjects', () => {
    expect(() => ask({ file: 'src/a.ts', name: 'a' })).toThrow('one subject at a time');
  });

  it('a file the tree does not hold', () => {
    expect(() => ask({ file: 'src/nope.ts' })).toThrow('`src/nope.ts` is not a file in the source tree');
  });

  it('without a source tree', () => {
    expect(() => dependents.run(HELP, { file: 'src/a.ts' })).toThrow('no source tree was read');
  });
});
