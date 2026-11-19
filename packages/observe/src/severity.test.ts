import { describe, expect, it } from 'vitest';
import type { AttributedRegion, DiffRegion } from '@variance-authority/core/attribute';
import { STRONG_GRADE, type RasterComparison } from '@variance-authority/raster';
import { describeChange } from './because.js';

/**
 * A review whose regions differ faintly and strongly. A repaint by a few levels
 * and a block of new content are both regions; the sentence names the strong
 * ones and counts the faint ones apart, so a reader opens the real change first.
 */

const comparison = {
  dimensionsChanged: false,
  before: { width: 100, height: 100 },
  after: { width: 100, height: 100 },
} as RasterComparison;

const region = (x: number, grade: number, component: string): AttributedRegion => ({
  region: { x, y: 0, width: 4, height: 4, pixels: 16, density: 1, grade },
  component,
});
const isolation = (regions: readonly AttributedRegion[]) => ({
  regions: regions.map(({ region }): DiffRegion => region),
  truncated: 0,
  truncatedPixels: 0,
});

describe('a verdict over faint and strong regions', () => {
  it('names the strong regions and counts the faint ones apart', () => {
    const regions = [region(0, 1, 'Link'), region(10, STRONG_GRADE, 'Hero'), region(20, 2, 'Footer')];

    expect(describeChange(comparison, isolation(regions), regions, 48)).toBe(
      '48 pixels differ across 1 strong region in Hero, and 2 faint regions',
    );
  });

  it('calls the regions faint when none is strong', () => {
    const regions = [region(0, 1, 'Link'), region(10, 2, 'Footer')];

    expect(describeChange(comparison, isolation(regions), regions, 32)).toBe(
      '32 pixels differ across 2 faint regions in Link, Footer',
    );
  });

  it('reads as before when every region is strong', () => {
    const regions = [region(0, STRONG_GRADE, 'Hero'), region(10, STRONG_GRADE, 'Card')];

    expect(describeChange(comparison, isolation(regions), regions, 32)).toBe('32 pixels differ across 2 regions in Hero, Card');
  });
});
