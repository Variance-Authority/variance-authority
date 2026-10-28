import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { lastCaseRunOf, layCases } from './case-landing.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'compact-last-run-'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/a.test.ts'), '');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('names the exact run by index rows without repeating long case identities', () => {
  const tests = Array.from({ length: 80 }, (_, at) => {
    const name = `case ${at} ${'with a descriptive parameter '.repeat(16)}`;
    return { id: `test/a.test.ts > ${name}`, name, file: 'test/a.test.ts', stopped: at === 7 };
  });
  const fresh = encodeAsSetExecutionIndex({ tests, modules: [] });
  const sections = layCases({}, fresh, root, { commit: 'first', tests: [{ file: 'test/a.test.ts', complete: false }] });
  const last = lastCaseRunOf(sections)!;
  expect(last.cases).toEqual(tests.map((test) => test.id));
  expect(sections.last!.length).toBeLessThan(Buffer.byteLength(JSON.stringify(last)) / 5);
  expect(JSON.parse(Buffer.from(sections.last!).toString()).cases).toEqual({ references: tests.map((_, at) => at) });

  // A completed later run retires all but one case and changes its row.
  const next = layCases(sections, encodeAsSetExecutionIndex({ tests: [tests[7]!], modules: [] }), root, {
    commit: 'second', tests: [{ file: 'test/a.test.ts', complete: true }],
  });
  expect(lastCaseRunOf(next)?.cases).toEqual([tests[7]!.id]);
  expect(lastCaseRunOf(next)?.before).toBe('first');
  expect(next.before).toBeDefined();
});

it('reads legacy identities without needing an index and refuses unresolved row references', () => {
  const named = { at: '2026-10-01T00:00:00.000Z', files: ['test/a.test.ts'], cases: ['test/a.test.ts > old'] };
  expect(lastCaseRunOf({ last: Buffer.from(JSON.stringify(named)) })).toEqual(named);
  const index = encodeAsSetExecutionIndex({ tests: [{ id: 'test/a.test.ts > one', name: 'one', file: 'test/a.test.ts' }], modules: [] });
  expect(lastCaseRunOf({ index, last: Buffer.from(JSON.stringify({ ...named, cases: { references: ['retired.test.ts > exact', 0] } })) })?.cases).toEqual(['retired.test.ts > exact', 'test/a.test.ts > one']);
  for (const references of [[1], [-1], [0.5], ['test/a.test.ts > retained', 4]]) {
    expect(lastCaseRunOf({ index, last: Buffer.from(JSON.stringify({ ...named, cases: { references } })) })).toBeUndefined();
  }
  expect(lastCaseRunOf({ last: Buffer.from(JSON.stringify({ ...named, cases: { references: [0] } })) })).toBeUndefined();
});

it('refuses malformed last-run files and membership shapes', () => {
  const named = { at: '2026-10-01T00:00:00.000Z', files: ['test/a.test.ts'], cases: ['test/a.test.ts > old'] };
  for (const run of [
    null,
    { ...named, files: null },
    { ...named, cases: [0] },
    { ...named, cases: undefined },
    { ...named, cases: { references: 0 } },
  ]) {
    expect(lastCaseRunOf({ last: Buffer.from(JSON.stringify(run)) })).toBeUndefined();
  }
});
