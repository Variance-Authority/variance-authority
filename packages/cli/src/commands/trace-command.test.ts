import { describe, expect, it } from 'vitest';
import type { RecordedTrace } from '@variance-authority/sense';
import { otlpOf } from './trace-otlp.js';

/**
 * The spans `variance trace --format otlp` prints: a run, its files, the phases
 * and cases inside each, on the runner's clock, and no span for a file the
 * runner never gave a start.
 */

const T0 = 1_800_000_001_250;

function trace(files: Extract<RecordedTrace, { files: unknown }>['files']): Extract<RecordedTrace, { files: unknown }> {
  return { recording: '/cache/coverage.bin', commit: 'abc123', files };
}

describe('the OTLP trace of a recording', () => {
  const spans = otlpOf(
    trace([
      {
        file: 'e2e/a.spec.ts',
        start: T0,
        cost: 900,
        phases: [{ name: 'setup', ms: 100 }, { name: 'cases', ms: 800 }],
        cases: [{ name: 'opens', duration: 300 }, { name: 'closes', duration: 200 }],
      },
      { file: 'e2e/b.spec.ts', start: T0 + 500, cost: 400, phases: [], cases: [] },
      { file: 'test/no-clock.test.ts', cost: 33, phases: [{ name: 'cases', ms: 33 }], cases: [{ name: 'x', duration: 3 }] },
    ]),
  ).resourceSpans[0].scopeSpans[0].spans;
  const named = (name: string) => spans.find((span) => span.name === name)!;

  it('nests run → file → phase → case on the runner clock, in nanoseconds', () => {
    const run = named('run');
    const file = named('e2e/a.spec.ts');
    const cases = named('cases');

    expect(run.parentSpanId).toBeUndefined();
    expect(run.startTimeUnixNano).toBe(`${T0}000000`);
    expect(run.endTimeUnixNano).toBe(`${T0 + 900}000000`);
    expect(file.parentSpanId).toBe(run.spanId);
    expect(file.endTimeUnixNano).toBe(`${T0 + 900}000000`);
    expect(named('setup').startTimeUnixNano).toBe(`${T0}000000`);
    expect(cases.parentSpanId).toBe(file.spanId);
    expect(cases.startTimeUnixNano).toBe(`${T0 + 100}000000`);
    expect(named('opens').parentSpanId).toBe(cases.spanId);
    expect(named('opens').startTimeUnixNano).toBe(`${T0 + 100}000000`);
    expect(named('closes').startTimeUnixNano).toBe(`${T0 + 400}000000`);
  });

  it('uses valid OTLP ids, one trace id throughout', () => {
    expect(new Set(spans.map((span) => span.traceId)).size).toBe(1);
    for (const span of spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/u);
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/u);
    }
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(spans.length);
  });

  it('yields no span for a file with no start offset, nor for what it holds', () => {
    expect(spans.map((span) => span.name)).not.toContain('test/no-clock.test.ts');
    expect(spans.map((span) => span.name)).not.toContain('x');
  });

  it('marks every placed span as derived and no measured one', () => {
    const marked = (name: string) => named(name).attributes.some((a) => a.key === 'variance.placed' && 'stringValue' in a.value && a.value.stringValue === 'derived');

    expect(['setup', 'cases', 'opens', 'closes'].map(marked)).toEqual([true, true, true, true]);
    expect(['run', 'e2e/a.spec.ts', 'e2e/b.spec.ts'].map(marked)).toEqual([false, false, false]);
  });

  it('gives a re-recording at the same commit a trace id of its own', () => {
    const at = (start: number) =>
      otlpOf(trace([{ file: 'e2e/a.spec.ts', start, cost: 10, phases: [], cases: [] }])).resourceSpans[0].scopeSpans[0].spans[0].traceId;

    expect(at(T0)).not.toBe(at(T0 + 60_000));
  });

  it('keeps two cases of one name two spans', () => {
    const twice = otlpOf(
      trace([
        {
          file: 'e2e/c.spec.ts',
          start: T0,
          cost: 20,
          phases: [{ name: 'cases', ms: 20 }],
          cases: [{ name: 'same', duration: 10 }, { name: 'same', duration: 10 }],
        },
      ]),
    ).resourceSpans[0].scopeSpans[0].spans;

    const same = twice.filter((span) => span.name === 'same');
    expect(same).toHaveLength(2);
    expect(new Set(twice.map((span) => span.spanId)).size).toBe(twice.length);
  });

  it('holds no span at all where no file has a start', () => {
    const none = otlpOf(trace([{ file: 'a.test.ts', cost: 3, phases: [], cases: [] }])).resourceSpans[0].scopeSpans[0].spans;
    expect(none).toEqual([]);
  });
});
