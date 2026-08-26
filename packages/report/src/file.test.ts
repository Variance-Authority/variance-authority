import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestValue } from '@variance-authority/core';
import type { RunReport } from './format.js';
import { readRunReport, writeRunReport } from './file.js';

describe('presentation evidence in a run-report file', () => {
  it('round-trips a comparable presentation effect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-presentation-report-'));
    const path = join(directory, 'run.json');
    const report = reportOf({
      verdict: 'changed',
      before: digestValue('before'),
      after: digestValue('after'),
      information: {
        contentPreserved: true,
        characters: { before: 80, after: 80, delta: 0 },
        elements: { before: 12, after: 12, delta: 0 },
        repeatedObjects: { before: 3, after: 3, delta: 0 },
      },
      effects: [{
        rule: 'SPACING_HIERARCHY_COLLISION',
        transition: 'introduced',
        owner: 'r0:0/4/1',
        nodes: ['r0:0/4/1/0', 'r0:0/4/1/1'],
        contract: 'underwriter-demand-record',
        after: {
          finding: 'H1',
          measurements: { outerMedianPx: 4, innerMedianPx: 3.99, ratio: 1.003 },
        },
      }],
    });

    await writeRunReport(path, report);
    expect(await readRunReport(path)).toEqual(report);
  });

  it('refuses a transition that carries the wrong side of its evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-presentation-report-'));
    const path = join(directory, 'run.json');
    const report = reportOf({
      verdict: 'changed',
      before: digestValue('before'),
      after: digestValue('after'),
      information: {
        contentPreserved: true,
        characters: { before: 1, after: 1, delta: 0 },
        elements: { before: 1, after: 1, delta: 0 },
        repeatedObjects: { before: 0, after: 0, delta: 0 },
      },
      effects: [{
        rule: 'SPACING_HIERARCHY_COLLISION',
        transition: 'introduced',
        owner: 'r0:0',
        nodes: ['r0:0/0', 'r0:0/1'],
        before: { finding: 'H1', measurements: { ratio: 1 } },
      }],
    } as never);
    await writeFile(path, JSON.stringify(report), 'utf8');

    await expect(readRunReport(path)).rejects.toThrow('does not carry the evidence its transition requires');
  });
});

function reportOf(presentation: NonNullable<RunReport['observations'][number]['signals']>['presentation']): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-26T00:00:00.000Z',
    identity: {
      renderer: 'fixture',
      engine: 'fixture@1',
      platform: 'fixture',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'durable',
    observations: [{
      subject: 'fixture:underwriter',
      verdict: 'changed',
      because: 'layout changed',
      changedPixels: 10,
      signals: { presentation },
      regions: [],
    }],
  };
}
