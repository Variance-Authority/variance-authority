import { describe, expect, it } from 'vitest';
import type { Observation } from '@variance-authority/observe';
import { recordOf } from './run.js';
import { UNREADABLE } from './run-fixture.js';

/**
 * The mapping from an `Observation` to the line a report carries.
 *
 * Asserted on a hand-built observation rather than behind a browser, which is the
 * whole reason `recordOf` is exported: this is where information gets lost if
 * anybody is careless, and every case below is a fact that used to be — or could
 * be — dropped on the way into the artifact.
 */

describe('recordOf', () => {
  const base: Observation = {
    subject: 'fixture:a',
    verdict: 'changed',
    because: '1000 pixel(s) differ across 2 region(s)',
    comparison: {
      width: 100,
      height: 40,
      dimensionsChanged: false,
      before: { width: 100, height: 40 },
      after: { width: 100, height: 40 },
      changed: { default: 1000, strict: 1200 },
      total: 4000,
      mask: { width: 100, height: 40, data: new Uint8Array(0), changed: 1000 },
    },
    isolation: { regions: [], truncated: 3, truncatedPixels: 42 },
    regions: [
      {
        region: { x: 0, y: 0, width: 40, height: 40, pixels: 900, density: 0.5 },
        path: '0/1',
        component: 'Stack',
        where: 'main',
        unattributed: false,
      },
      {
        region: { x: 50, y: 0, width: 10, height: 10, pixels: 100, density: 1 },
        path: '0/2',
        component: 'Toggle',
        where: 'main → toggle',
        unattributed: false,
      },
    ],
    rendered: true,
    missingFonts: ['Inter'],
  };

  it('ranks the named cause above the larger region it displaced', () => {
    // Area measures displacement, not cause: an edit reflows far more of its
    // surroundings than of itself, so `Stack` outranks `Toggle` on pixels alone.
    const record = recordOf(base, { causes: ['Toggle'] });

    expect(record.regions.map((region) => region.component)).toEqual(['Toggle', 'Stack']);
    expect(record.regions[0]?.cause).toBe(true);
  });

  it('reports the truncated tail rather than presenting a capped list as complete', () => {
    expect(recordOf(base).truncated).toEqual({ regions: 3, pixels: 42 });
  });

  it('carries missing fonts through, because the images are of a substituted font', () => {
    expect(recordOf(base).missingFonts).toEqual(['Inter']);
  });

  it('carries the collector’s diagnostics onto the record and into its sentence', () => {
    // A diagnostic that stops at `RenderDocument` is a fact nobody can act on. The
    // record is the whole contract with the report, the MCP tools and the exit
    // code, so a subject observed from a document the collector could not fully
    // read has to say so where all three of them look.
    const record = recordOf(base, { diagnostics: [UNREADABLE] });

    expect(record.diagnostics).toEqual([UNREADABLE]);
    expect(record.because).toContain('unreadable-stylesheet');
  });

  it('states the pixels the default policy forgave when the verdict is `unchanged`', () => {
    // "Zero pixels changed" after antialiasing forgiveness is a different claim
    // from "the images are identical", and quoting only the forgiving policy is
    // the most common way to lie with a pixel measurement.
    const unchanged: Observation = {
      ...base,
      verdict: 'unchanged',
      because: 'no pixels differ',
      comparison: { ...base.comparison!, changed: { default: 0, strict: 37 } },
      regions: [],
    };

    expect(recordOf(unchanged).because).toContain('37 pixel(s) do differ under the strict policy');
  });

  it('never turns a nearest node into an attribution', () => {
    // `nearest` answers "what is this near", which is a different claim from
    // "this is what changed". Writing it into `component` would make a trace tool
    // count an appearance no box actually contained.
    const unattributed: Observation = {
      ...base,
      regions: [
        {
          region: { x: 0, y: 0, width: 4, height: 4, pixels: 9, density: 1 },
          unattributed: true,
          nearest: { path: '0/1', component: 'Card', where: 'main → card' },
        },
      ],
    };

    const region = recordOf(unattributed).regions[0];
    expect(region?.component).toBeUndefined();
    expect(region?.unattributed).toBe(true);
    expect(region?.where).toBe('near Card (main → card)');
  });
});
