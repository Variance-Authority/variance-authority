import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import { declarationOf } from './parameters.js';

/**
 * `parameters.variance`, which is somebody else's object until it is checked.
 *
 * Every refusal here excludes the story with the sentence that says why, rather
 * than reading the story at the run's viewport. A width list that half-parsed
 * would be a breakpoint nobody is watching, reported as green.
 */

const RUN: Viewport = { width: 1280, height: 800, deviceScaleFactor: 1, colorScheme: 'light' };

describe("a story's own parameters", () => {
  it('excludes a story that says `exclude: true`, and reads one that says `false`', () => {
    expect(declarationOf({ exclude: true }, RUN)).toEqual({
      excluded: 'excluded by its own parameters (`variance.exclude`)',
    });
    expect(declarationOf({ exclude: false }, RUN)).toEqual({});
  });

  it('lays a partial viewport over the run, so a story says only what differs', () => {
    expect(declarationOf({ viewport: { colorScheme: 'dark' } }, RUN)).toEqual({
      viewport: { ...RUN, colorScheme: 'dark' },
    });
  });

  it('carries widths as written, with or without a viewport', () => {
    expect(declarationOf({ widths: [375, 1280] }, RUN)).toEqual({ widths: [375, 1280] });
    expect(declarationOf({ viewport: { deviceScaleFactor: 2 }, widths: [375] }, RUN)).toEqual({
      viewport: { ...RUN, deviceScaleFactor: 2 },
      widths: [375],
    });
  });

  it('refuses a key it does not read by name, which is where a typo shows up', () => {
    const declared = declarationOf({ width: [375] }, RUN);

    expect(declared).toHaveProperty('excluded');
    expect((declared as { excluded: string }).excluded).toContain('`width`');
  });

  it.each([
    ['a width in a unit', { widths: [375, '1280px'] }, '`parameters.variance.widths`'],
    ['a fractional width', { widths: [375.5] }, '`parameters.variance.widths`'],
    ['a non-boolean exclude', { exclude: 'yes' }, '`parameters.variance.exclude`'],
    ['an unknown viewport field', { viewport: { scale: 2 } }, '`parameters.variance.viewport`'],
    ['a colour scheme it cannot emulate', { viewport: { colorScheme: 'sepia' } }, '`parameters.variance.viewport`'],
    ['something other than an object', 'mobile', '`parameters.variance`'],
  ])('excludes a story whose declaration has %s, naming the key', (_, raw, named) => {
    const declared = declarationOf(raw, RUN);

    expect(declared).toHaveProperty('excluded');
    expect((declared as { excluded: string }).excluded).toContain(named);
  });

  it('refuses a partial viewport when there is no run viewport to complete it', () => {
    const declared = declarationOf({ viewport: { width: 375 } }, undefined);

    expect((declared as { excluded: string }).excluded).toContain('missing height, deviceScaleFactor, colorScheme');
  });
});
