import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { caseHeard, decodeExecutionIndex, rowOf } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { createExecutionRecorder } from './execution.js';
import { INSTRUMENTATION, inRoot, instrumented, pageReporting } from './execution.fixture.js';
import { caseKey } from './test-coordinate.js';

describe('what a Playwright case said and read', () => {
  it('lays what a case said, in its beforeEach and its body, on its row, and a case that only said something is a case', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const owner = 'tests/checkout.spec.ts';
      const pays = { name: 'pays', id: 'one' };
      const refunds = { name: 'refunds', id: 'two' };

      let standing: PreconditionStanding = { at: 'beforeEach', key: caseKey(owner, pays.id), depth: 1 };
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile }, undefined, () => standing);
      variancePrecondition('fixture', { network: 'live' });
      standing = { at: 'case', key: caseKey(owner, pays.id) };
      variancePrecondition('fixture', { network: 'mocked' });
      await recorder.note(
        pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }] }),
        owner,
        pays,
      );
      recorder.mark(owner, true, pays);
      standing = { at: 'case', key: caseKey(owner, refunds.id) };
      variancePrecondition('fixture', { seeded: true });
      recorder.mark(owner, false, refunds);
      await recorder.close();

      const index = decodeExecutionIndex(await readFile(coverageFile));
      expect(index.tests.map((one) => [one.name, rowOf(one)?.map(({ name, value, level }) => [name, value, level])]))
        .toEqual([['pays', [['fixture:network', 'mocked', 0xffff]]], ['refunds', [['fixture:seeded', true, 0xffff]]]]);
      expect(rowOf(index.tests[0]!)![0]!.site).toMatch(/execution-heard\.test\.ts:\d+$/);
    });
  });

  it('leaves what a case read unheard when it drove a page without the collector, and empty when it drove none', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const owner = 'tests/checkout.spec.ts';
      const pays = { name: 'pays', id: 'one' };
      const refunds = { name: 'refunds', id: 'two' };
      const ships = { name: 'ships', id: 'three' };

      let standing: PreconditionStanding = { at: 'case', key: caseKey(owner, ships.id) };
      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile }, undefined, () => standing);
      await recorder.note(pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }], read: [] }), owner, ships);
      recorder.mark(owner, true, ships);
      standing = { at: 'case', key: caseKey(owner, pays.id) };
      variancePrecondition('fixture', { network: 'mocked' });
      await recorder.note(pageReporting(undefined), owner, pays);
      recorder.mark(owner, true, pays);
      standing = { at: 'case', key: caseKey(owner, refunds.id) };
      recorder.mark(owner, false, refunds);
      await recorder.close();

      const index = decodeExecutionIndex(await readFile(coverageFile));
      const heard = Object.fromEntries(index.tests.map((one) => [one.name, caseHeard(one)]));
      expect(heard['pays']).toEqual({ preconditions: [expect.objectContaining({ name: 'fixture:network' })] });
      expect(heard['refunds']).toEqual({ preconditions: [], reads: [], misused: [] });
      expect(heard['ships']).toEqual({ preconditions: [], reads: [], misused: [] });
    });
  });

});
