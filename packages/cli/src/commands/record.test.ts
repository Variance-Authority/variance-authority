import { describe, expect, it } from 'vitest';
import type { Observation } from '@variance-authority/observe';
import type { Described } from '@variance-authority/raster';
import type { FindingRecord } from '@variance-authority/report';
import { dated, diagnosticsOf, inherited, marksOf, qualification } from './record.js';
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

  it('adds a presentation consequence without inventing document or pixel signals', () => {
    const presentation = {
      verdict: 'changed' as const,
      before: 'sha256:before' as never,
      after: 'sha256:after' as never,
      information: {
        contentPreserved: true,
        characters: { before: 20, after: 20, delta: 0 },
        elements: { before: 4, after: 4, delta: 0 },
        repeatedObjects: { before: 2, after: 2, delta: 0 },
      },
      effects: [{
        rule: 'SPACING_HIERARCHY_COLLISION',
        transition: 'introduced' as const,
        owner: 'r0:0',
        nodes: ['r0:0/0', 'r0:0/1'],
        contract: 'demand-record',
        after: { finding: 'H1', measurements: { outerMedianPx: 4, innerMedianPx: 3.99 } },
      }],
    };

    expect(recordOf({ ...base, signals: undefined }, { presentation }).signals).toEqual({
      presentation,
    });
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

    expect(recordOf(unchanged).because).toContain('37 pixels differ with antialiasing counted');
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


describe('diagnosticsOf', () => {
  const document = { diagnostics: [{ severity: 'warn', code: 'host-chosen-font', message: 'a' }] };

  it('carries what the collector said about the reading, not only what the page said', () => {
    // A Storybook story that finished by reporting it failed, a preview that had
    // to be reloaded to show it: real images a run can compare, produced in a way
    // that changes what a green verdict means. They arrive on the collected
    // subject rather than in the document, and this is the only place they can
    // join the document's own.
    const merged = diagnosticsOf({
      ok: true,
      document,
      diagnostics: [{ severity: 'warn', code: 'story-preview', message: 'finished with status error' }],
    } as never);

    expect(merged.map((diagnostic) => diagnostic.code)).toEqual(['host-chosen-font', 'story-preview']);
  });

  it('says a thing once however many of the three raised it', () => {
    const twice = { severity: 'warn', code: 'story-preview', message: 'same sentence' } as const;

    const merged = diagnosticsOf({
      ok: true,
      document: { diagnostics: [twice] },
      snapshot: { diagnostics: [twice] },
      diagnostics: [twice],
    } as never);

    expect(merged).toHaveLength(1);
  });
});

describe('qualification', () => {
  it('says nothing when the collection had nothing to complain about', () => {
    expect(qualification([])).toBe('');
  });

  it('counts a code carrying more than one fact instead of repeating it', () => {
    // The first run of every browserless suite: a capture with no font
    // identities and no font content hashes raises `unverified-fonts` twice,
    // with two different messages, and both belong on the record. Printed
    // one-per-entry the line read `unverified-fonts (warn), unverified-fonts
    // (warn)`, which reads as the tool stuttering rather than as two things
    // being wrong.
    const line = qualification([
      { severity: 'warn', code: 'unverified-fonts', message: 'no font identities supplied' },
      { severity: 'warn', code: 'unverified-fonts', message: 'no font content hashes supplied' },
      { severity: 'warn', code: 'portals-not-resolved', message: 'no portal provider supplied' },
    ]);

    expect(line).toContain('unverified-fonts (warn) ×2');
    expect(line).toContain('portals-not-resolved (warn)');
    expect(line).not.toContain('portals-not-resolved (warn) ×');
  });

  it('keeps one code at two severities apart, because they exit differently', () => {
    expect(
      qualification([
        { severity: 'warn', code: 'cross-origin-stylesheet', message: 'a' },
        { severity: 'error', code: 'cross-origin-stylesheet', message: 'b' },
      ]),
    ).toContain('cross-origin-stylesheet (warn), cross-origin-stylesheet (error)');
  });
});

/**
 * Crossing this run's defects against the baseline's, held to the direction that
 * is safe to be wrong in.
 *
 * A finding is read from one render with no baseline consulted, so the list is
 * identical on the run that introduced a defect and on the two hundred runs
 * after it. `standing` is the only thing that separates them, and it is only
 * ever set from evidence: either the document is byte-for-byte the baseline's,
 * or the baseline recorded what was found in it. Absent stays absent. Guessing
 * `false` from a missing list is the failure — it prints *you introduced this*
 * over every inherited defect in a suite, on the first run after an upgrade.
 */

describe('dated', () => {
  const one: FindingRecord = {
    rule: 'control-without-name',
    band: 'a11y',
    what: 'a control has no accessible name',
    path: '0/1/0',
  };
  const two: FindingRecord = { ...one, rule: 'nested-interactive', path: '0/2/0' };

  it('leaves the question open when there is no baseline to have asked it of', () => {
    expect(dated([one], null)).toEqual([one]);
    expect(dated([one], null)?.[0]).not.toHaveProperty('standing');
  });

  it('leaves it open when a baseline exists and recorded nothing', () => {
    // A baseline promoted before `Raster.findingMarks` existed. It is silent, not
    // empty, and the two are the same bytes on disk — which is exactly why the
    // reading has to be *unknown* rather than *the baseline had none of these*.
    expect(dated([one], inherited(described(undefined), false))?.[0]).not.toHaveProperty(
      'standing',
    );
  });

  it('crosses the marks the baseline recorded against the ones found now', () => {
    const out = dated([one, two], inherited(described(['control-without-name@0/1/0']), false));

    expect(out?.map((finding) => finding.standing)).toEqual([true, false]);
  });

  it('calls every defect inherited when the document did not change at all', () => {
    // The settled path. The render was measured against the same document the
    // baseline was painted from, so whatever inspection finds now it found then —
    // by identity, with no stored list required and no way to be wrong. It is the
    // one branch that answers correctly against a baseline written before marks
    // were kept, which is every baseline in every repository on the day of the
    // upgrade.
    const out = dated([one, two], inherited(described(undefined), true));

    expect(out?.map((finding) => finding.standing)).toEqual([true, true]);
  });

  it('distinguishes two elements the same rule fired on', () => {
    // `${rule}@${path}` rather than the rule alone. A rule that fired on a control
    // the baseline had and on one the change added is the case the panel exists to
    // separate, and keying on the rule would report the new element as inherited.
    const out = dated([one, two], inherited(described(['nested-interactive@0/2/0']), false));

    expect(out?.map((finding) => finding.standing)).toEqual([false, true]);
  });

  it('does not read a copy edit beside a defect as the defect moving', () => {
    // `what` quotes the text it found, so a mark that carried it would say the old
    // defect went away and a new one arrived in the same place on every wording
    // change. The mark is the rule and the node, and nothing else.
    const reworded = { ...one, what: 'this control still has no accessible name' };
    const out = dated([reworded], inherited(described(marksOf([one])), false));

    expect(out?.[0]?.standing).toBe(true);
  });

  it('carries nothing through when the run inspected nothing', () => {
    expect(dated(undefined, inherited(described([]), false))).toBeUndefined();
  });
});

/** A baseline sidecar carrying only the field this crossing reads. */
function described(marks: readonly string[] | undefined): Described {
  return {
    documentDigest: 'sha256:baseline',
    ...(marks === undefined ? {} : { findingMarks: marks }),
  } as Described;
}
