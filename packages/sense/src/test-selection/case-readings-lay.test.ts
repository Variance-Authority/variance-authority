import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layReadings } from './case-readings.js';

/**
 * Sections the JavaScript lay wrote before the addon took it over, over
 * generated runs whose readings pair by position, pair out of order, and add
 * or drop regions; each a step of a sequence that lays every run over the
 * section the one before it wrote. Buffers are indices into `buffers`.
 */
interface Fixtures {
  readonly buffers: readonly string[];
  readonly steps: readonly {
    readonly kept: number | null;
    readonly previous: number | null;
    readonly landed: number | null;
    readonly cases: readonly string[];
    readonly run: {
      readonly fresh: number;
      readonly announced: readonly string[];
      readonly same: readonly string[];
      readonly inputs: readonly [string, string][] | null;
    } | null;
    readonly out: number | null;
  }[];
}

const fixtures = JSON.parse(readFileSync(new URL('./__fixtures__/readings-lay.json', import.meta.url), 'utf8')) as Fixtures;
const bytes = (at: number | null): Buffer | undefined => (at === null ? undefined : Buffer.from(fixtures.buffers[at]!, 'base64'));

describe('layReadings against the sections the JavaScript lay wrote', () => {
  it('writes each one byte for byte', () => {
    const written = fixtures.steps.map(({ kept, previous, landed, cases, run }) => layReadings(bytes(kept), bytes(previous), bytes(landed), new Set(cases), run === null ? undefined : {
      fresh: bytes(run.fresh)!,
      announced: new Set(run.announced),
      same: run.same,
      ...(run.inputs === null ? {} : { inputs: new Map(run.inputs) }),
    })?.toString('base64') ?? null);

    expect(written).toEqual(fixtures.steps.map(({ out }) => (out === null ? null : fixtures.buffers[out]!)));
  });
});
