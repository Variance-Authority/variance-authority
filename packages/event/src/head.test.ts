// The claim under test is that a process serving several executions at once
// attributes each announcement to the one it was serving, that a driver reading
// the report while the run is still going never sees half a line, and that a
// process nobody configured writes nothing at all.

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENT_DIRECTORY_VARIABLE,
  EVENT_HEAD_VARIABLE,
  collectEvents,
  watchEventReports,
  type EventCollector,
  type EventWatch,
  type HeadEventReport,
} from './head.js';
import { vae, vaEnd, vaStart } from './index.js';

const opened: EventCollector[] = [];
const watching: EventWatch[] = [];

function collect(directory: string, head = 'api'): EventCollector {
  const collector = collectEvents({ directory, head });
  opened.push(collector);
  return collector;
}

function watch(directory: string): { reports: HeadEventReport[]; watch: EventWatch } {
  const reports: HeadEventReport[] = [];
  const running = watchEventReports(directory, (report) => reports.push(report));
  watching.push(running);
  return { reports, watch: running };
}

function directory(): string {
  return mkdtempSync(join(tmpdir(), 'variance-events-'));
}

function written(where: string, head = 'api'): HeadEventReport[] {
  const file = join(where, `events-${head}-${process.pid}.ndjson`);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as HeadEventReport);
}

afterEach(() => {
  for (const collector of opened.splice(0)) collector.close();
  for (const running of watching.splice(0)) running.close();
  delete process.env[EVENT_DIRECTORY_VARIABLE];
  delete process.env[EVENT_HEAD_VARIABLE];
});

describe('collectEvents', () => {
  it('installs nothing when no directory is configured', () => {
    const collector = collectEvents({ head: 'api' });
    expect(collector.collecting).toBe(false);
    expect(collector.enter('journey', () => vae('checkout', 'upsell', 'decided'))).toBeUndefined();
  });

  it('reads the directory and the head from the environment', () => {
    const where = directory();
    process.env[EVENT_DIRECTORY_VARIABLE] = where;
    process.env[EVENT_HEAD_VARIABLE] = 'pricing';
    const collector = collectEvents();
    opened.push(collector);
    expect(collector.head).toBe('pricing');
    collector.enter('a-journey', () => vae('checkout', 'upsell', 'decided'));
    expect(written(where, 'pricing')).toHaveLength(1);
  });

  it('attributes an announcement to the execution it was serving', () => {
    const where = directory();
    const collector = collect(where);
    collector.enter('journey-one', () => vae('checkout', 'upsell', 'decided'));
    expect(written(where)).toEqual([
      {
        version: 1,
        head: 'api',
        journey: 'journey-one',
        phase: 'once',
        location: 'checkout',
        subject: 'upsell',
        action: 'decided',
      },
    ]);
  });

  it('keeps two concurrent executions apart', async () => {
    // The reason a journey is on the wire at all: without it, one test's wait is
    // satisfied by another test's decision and both pass for the wrong reason.
    const where = directory();
    const collector = collect(where);
    await Promise.all([
      collector.enter('journey-one', async () => {
        await after(5);
        vae('checkout', 'upsell', 'decided');
      }),
      collector.enter('journey-two', async () => {
        vae('checkout', 'upsell', 'decided');
        await after(10);
        vae('checkout', 'upsell', 'shown');
      }),
    ]);
    expect(written(where).map((report) => [report.journey, report.action])).toEqual([
      ['journey-two', 'decided'],
      ['journey-one', 'decided'],
      ['journey-two', 'shown'],
    ]);
  });

  it('stays inside an execution across an await', () => {
    const where = directory();
    const collector = collect(where);
    return collector
      .enter('journey-one', async () => {
        await after(1);
        vae('checkout', 'upsell', 'decided');
      })
      .then(() => {
        expect(written(where)[0]?.journey).toBe('journey-one');
      });
  });

  it('announces without a journey rather than guessing one', () => {
    const where = directory();
    collect(where);
    vae('checkout', 'upsell', 'decided');
    expect(written(where)[0]).not.toHaveProperty('journey');
  });

  it('carries the phase a process was bounded with', () => {
    const where = directory();
    const collector = collect(where);
    collector.enter('journey-one', () => {
      vaStart('checkout', 'payment', 'authorizing');
      vaEnd('checkout', 'payment', 'authorizing');
    });
    expect(written(where).map((report) => report.phase)).toEqual(['start', 'end']);
  });

  it('gives the global back when it closes', () => {
    const where = directory();
    const collector = collectEvents({ directory: where, head: 'api' });
    collector.close();
    expect(() => vae('checkout', 'upsell', 'decided')).not.toThrow();
    expect(() => written(where)).toThrow();
  });
});

describe('watchEventReports', () => {
  it('reads a directory nothing has written to as silence', () => {
    const { reports } = watch(join(directory(), 'never-created'));
    expect(reports).toEqual([]);
  });

  it('delivers announcements as they land', async () => {
    const where = directory();
    const collector = collect(where);
    const { reports } = watch(where);
    collector.enter('journey-one', () => vae('checkout', 'upsell', 'decided'));
    await expect.poll(() => reports.map((report) => report.action)).toEqual(['decided']);
  });

  it('delivers each announcement once', async () => {
    const where = directory();
    const collector = collect(where);
    const { reports, watch: running } = watch(where);
    collector.enter('journey-one', () => vae('checkout', 'upsell', 'decided'));
    running.poll();
    running.poll();
    collector.enter('journey-one', () => vae('checkout', 'upsell', 'shown'));
    running.poll();
    running.poll();
    expect(reports.map((report) => report.action)).toEqual(['decided', 'shown']);
  });

  it('leaves a line that is still being written for the next look', () => {
    const where = directory();
    const file = join(where, `events-api-${process.pid}.ndjson`);
    writeFileSync(file, '{"version":1,"head":"api","phase":"once","location":"checkout"');
    const { reports, watch: running } = watch(where);
    running.poll();
    expect(reports).toEqual([]);
    appendFileSync(file, ',"subject":"upsell","action":"decided"}\n');
    running.poll();
    expect(reports.map((report) => report.action)).toEqual(['decided']);
  });

  it('skips a line it cannot read rather than losing the run', () => {
    const where = directory();
    const file = join(where, `events-api-${process.pid}.ndjson`);
    writeFileSync(file, 'from a later version of this package\n');
    appendFileSync(
      file,
      '{"version":1,"head":"api","phase":"once","location":"checkout","subject":"upsell","action":"decided"}\n',
    );
    const { reports, watch: running } = watch(where);
    running.poll();
    expect(reports.map((report) => report.action)).toEqual(['decided']);
  });

  it('ignores files no head wrote', () => {
    const where = directory();
    writeFileSync(join(where, 'coverage.json'), '{}');
    const { reports, watch: running } = watch(where);
    running.poll();
    expect(reports).toEqual([]);
  });
});
