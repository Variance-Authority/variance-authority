import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  accessibilitySnapshot,
  type ComponentHash,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import { observeRasters } from './observe.js';

/**
 * A subject that occupies no pixels is still a subject.
 *
 * Measured on Material UI's unit tier: 1109 of 4371 subjects. Its
 * `describeConformance` harness mounts each component with no children, so
 * `<AlertTitle />` is an empty div with margins and occupies nothing. Refusing to
 * photograph that is right; refusing the whole subject reported a quarter of the
 * tier as unobserved while the capture held its markup, its rules, its component
 * hashes and its accessibility tree, and nothing about any of them was in doubt.
 *
 * So the pixel axis reports `unobservable` — not `unchanged`, which is a
 * measurement that found nothing moved, and would let a reader take the image as
 * evidence it never was — and the document decides the verdict, which is the one
 * place in the codebase where it is allowed to.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium-existing-page',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

function image(): string {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
}

/** A capture of a subject that rendered nothing: everything but the photograph. */
function empty(documentDigest: string, components?: readonly ComponentHash[]): Raster {
  return {
    documentDigest,
    identity: IDENTITY,
    missingFonts: [],
    accessibility: accessibilitySnapshot(IDENTITY.engine, ['- generic']),
    ...(components === undefined ? {} : { components }),
  };
}

function painted(documentDigest: string): Raster {
  return {
    documentDigest,
    identity: IDENTITY,
    width: 2,
    height: 2,
    bytes: image(),
    missingFonts: [],
    accessibility: accessibilitySnapshot(IDENTITY.engine, ['- generic']),
  };
}

/** `text` is the band these cases move; the other three are held still. */
function hash(component: string, text: string): ComponentHash {
  return {
    component,
    instances: 1,
    structure: 'v1:structure',
    semantics: 'v1:semantics',
    text,
    style: 'v1:style',
  };
}

describe('a subject with no pixels', () => {
  it('is unchanged when its document is', async () => {
    const result = await observeRasters('AlertTitle', empty('v1:same'), empty('v1:same'));

    expect(result).toMatchObject({
      verdict: 'unchanged',
      signals: { document: 'unchanged', pixels: 'unobservable' },
      regions: [],
    });
    expect(result.because).toContain('occupies no pixels on either side');
  });

  it('is changed when its document moved, and names the components that caused it', async () => {
    const result = await observeRasters(
      'AlertTitle',
      empty('v1:before', [hash('AlertTitle', 'v1:a'), hash('Paper', 'v1:same')]),
      empty('v1:after', [hash('AlertTitle', 'v1:b'), hash('Paper', 'v1:same')]),
    );

    expect(result).toMatchObject({
      verdict: 'changed',
      signals: { document: 'changed', pixels: 'unobservable' },
      causes: ['AlertTitle'],
    });
  });

  it('is changed when only its accessibility tree moved', async () => {
    const before = empty('v1:same');
    const after: Raster = {
      ...before,
      accessibility: accessibilitySnapshot(IDENTITY.engine, ['- alert']),
    };

    const result = await observeRasters('AlertTitle', before, after);

    expect(result).toMatchObject({
      verdict: 'changed',
      signals: {
        document: 'unchanged',
        pixels: 'unobservable',
        accessibility: { verdict: 'changed' },
      },
    });
  });

  // Not `incomparable`. Nothing about the two records is mismatched — same
  // painter, same subject, same kind of evidence — and a subject that started or
  // stopped painting is the most reviewable thing that can happen to it: a portal
  // that broke, or a child that finally arrived. Filing that under the verdict
  // nobody reviews would lose the one finding.
  it('reports gaining pixels as a change, not as an incomparable pair', async () => {
    const result = await observeRasters('AlertTitle', empty('v1:same'), painted('v1:same'));

    expect(result).toMatchObject({ verdict: 'changed', signals: { pixels: 'changed' } });
    expect(result.because).toContain('occupied no pixels when the baseline was recorded');
    expect(result.because).toContain('2×2 device pixels');
  });

  it('reports losing pixels as a change', async () => {
    const result = await observeRasters('AlertTitle', painted('v1:same'), empty('v1:same'));

    expect(result).toMatchObject({ verdict: 'changed', signals: { pixels: 'changed' } });
    expect(result.because).toContain('now occupies none');
  });
});
