import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  accessibilitySnapshot,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core';
import { observeRasters } from './observe.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium-existing-page',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

function image(red: number): string {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = red;
    png.data[index + 1] = 0;
    png.data[index + 2] = 0;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

function raster(
  documentDigest: string,
  bytes: string,
  aria: ReturnType<typeof accessibilitySnapshot>,
): Raster {
  return {
    documentDigest,
    identity: IDENTITY,
    width: 2,
    height: 2,
    bytes,
    missingFonts: [],
    accessibility: aria,
  };
}

describe('independent document, pixel and browser accessibility signals', () => {
  const quiet = image(0);
  const moved = image(255);
  const namedSave = accessibilitySnapshot(IDENTITY.engine, ['- button "Save"']);
  const namedSubmit = accessibilitySnapshot(IDENTITY.engine, ['- button "Submit"']);
  const noExposedAria = accessibilitySnapshot(IDENTITY.engine, ['']);

  it('records a document-only change without inventing a pixel or ARIA verdict', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', quiet, namedSave),
      raster('v1:after', quiet, namedSave),
    );

    expect(result).toMatchObject({
      verdict: 'unchanged',
      signals: {
        document: 'changed',
        pixels: 'unchanged',
        accessibility: { verdict: 'unchanged' },
      },
      regions: [],
    });
  });

  it('reports pixels independently when the browser accessibility tree is quiet', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', quiet, namedSave),
      raster('v1:after', moved, namedSave),
    );

    expect(result).toMatchObject({
      verdict: 'changed',
      signals: {
        document: 'changed',
        pixels: 'changed',
        accessibility: { verdict: 'unchanged' },
      },
    });
  });

  it('retains the browser ARIA diff when pixels are quiet', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', quiet, namedSave),
      raster('v1:after', quiet, namedSubmit),
    );

    expect(result).toMatchObject({
      verdict: 'changed',
      signals: {
        document: 'changed',
        pixels: 'unchanged',
        accessibility: {
          verdict: 'changed',
          before: { roots: ['- button "Save"'] },
          after: { roots: ['- button "Submit"'] },
        },
      },
      regions: [],
    });
  });

  it('refuses one-sided accessibility evidence instead of reading it as empty', async () => {
    const before = raster('v1:before', quiet, namedSave);
    const { accessibility: _missing, ...withoutAccessibility } = before;
    void _missing;

    const result = await observeRasters(
      'button',
      withoutAccessibility,
      raster('v1:after', quiet, namedSubmit),
    );

    expect(result).toMatchObject({
      verdict: 'incomparable',
      signals: {
        accessibility: {
          verdict: 'incomparable',
          after: { roots: ['- button "Submit"'] },
        },
      },
    });
    expect(result.signals?.accessibility?.before).toBeUndefined();
  });

  it('treats an observed empty ARIA tree as a signal rather than missing evidence', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', quiet, noExposedAria),
      raster('v1:after', quiet, namedSave),
    );

    expect(result).toMatchObject({
      verdict: 'changed',
      signals: {
        pixels: 'unchanged',
        accessibility: {
          verdict: 'changed',
          before: { roots: [''] },
          after: { roots: ['- button "Save"'] },
        },
      },
    });
  });
});
