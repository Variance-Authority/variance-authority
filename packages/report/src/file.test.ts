import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestValue } from '@variance-authority/core/format';
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

  it('round-trips a side that supplied no reading as changed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-presentation-report-'));
    const path = join(directory, 'run.json');
    const report = reportOf({
      verdict: 'changed',
      because: 'the baseline supplied no presentation reading',
      after: digestValue('after'),
    });

    await writeRunReport(path, report);
    expect(await readRunReport(path)).toEqual(report);
  });

  it('refuses a one-sided reading whose because is empty, or that claims compared evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-presentation-report-'));
    const path = join(directory, 'run.json');

    await writeFile(path, JSON.stringify(reportOf({ verdict: 'changed', after: digestValue('after') } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('has no before and after presentation digests');

    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'changed',
      because: 'the baseline supplied no presentation reading',
      after: digestValue('after'),
      effects: [],
    } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('names a missing side but claims compared evidence');

    await writeFile(path, JSON.stringify(reportOf({ verdict: 'changed', because: 42 } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('.because is not a string');

    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'changed',
      because: ' ',
      after: digestValue('after'),
    } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('.because is empty');

    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'changed',
      because: 'the baseline supplied no presentation reading',
      before: digestValue('before'),
      after: 42,
    } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('has a presentation digest that is not a string');

    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'changed',
      because: 'the baseline supplied no presentation reading',
    } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('names a missing side but carries no digest of the side it read');

    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'unchanged',
      because: 'the baseline supplied no presentation reading',
      before: digestValue('before'),
    } as never)), 'utf8');
    await expect(readRunReport(path)).rejects.toThrow('names a missing side but is not changed');
  });

  it('refuses the incomparable verdict ADR-0090 removed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-presentation-report-'));
    const path = join(directory, 'run.json');
    await writeFile(path, JSON.stringify(reportOf({
      verdict: 'incomparable',
      because: 'the baseline supplied no presentation reading',
    } as never)), 'utf8');

    await expect(readRunReport(path)).rejects.toThrow('.verdict is not unchanged or changed');
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
