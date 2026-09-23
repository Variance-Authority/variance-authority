import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './bin.js';
import { EXIT_CLEAN } from './exit.js';
import { finalizeJestJourneys, stitchJourneyArtifacts } from '@variance-authority/sense/test-selection';

vi.mock('@variance-authority/sense/test-selection', () => ({
  finalizeJestJourneys: vi.fn(),
  stitchJourneyArtifacts: vi.fn(),
}));

const finalize = vi.mocked(finalizeJestJourneys);
const stitch = vi.mocked(stitchJourneyArtifacts);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the public journey artifact commands', () => {
  it('finalizes a named artifact without reading project configuration', async () => {
    finalize.mockResolvedValue({ tests: 65, modules: 374, crossings: 60_015, renumbered: [] });
    const out: string[] = [];
    const code = await main(['journeys', 'finalize', 'artifacts/journeys.bin'], {
      out: (text) => out.push(text),
      err: () => {},
    });

    expect(code).toBe(EXIT_CLEAN);
    expect(finalize).toHaveBeenCalledWith(resolve('artifacts/journeys.bin'));
    expect(out.join('')).toContain('65 tests, 374 modules, 60015 crossings');
    expect(out.join('')).not.toContain('regions');
  });

  it('stitches named shard artifacts without reading project configuration', async () => {
    stitch.mockResolvedValue({
      tests: 130,
      modules: 400,
      crossings: 120_030,
      shards: 2,
      renumbered: ['src/cart.ts'],
    });
    const out: string[] = [];
    const code = await main(
      ['journeys', 'stitch', 'shard-0.bin', 'shard-1.bin', '--into', 'journeys.bin'],
      { out: (text) => out.push(text), err: () => {} },
    );

    expect(code).toBe(EXIT_CLEAN);
    expect(stitch).toHaveBeenCalledWith(
      [resolve('shard-0.bin'), resolve('shard-1.bin')],
      resolve('journeys.bin'),
    );
    expect(out.join('')).toContain('stitched 2 shards');
    expect(out.join('')).toContain('1 file was cut into different regions');
    expect(out.join('')).toContain('  src/cart.ts\n');
  });

  it('parses the two operations as paths rather than journey readings', () => {
    expect(parseArgs(['journeys', 'finalize', 'journeys.bin'])).toMatchObject({
      command: 'journeys',
      operation: 'finalize',
      journeyFile: resolve('journeys.bin'),
    });
    expect(
      parseArgs(['journeys', 'stitch', 'one.bin', '--into', 'all.bin']),
    ).toMatchObject({
      command: 'journeys',
      operation: 'stitch',
      shards: [resolve('one.bin')],
      into: resolve('all.bin'),
    });
  });
});
