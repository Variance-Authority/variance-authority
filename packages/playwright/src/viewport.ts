import type { Viewport } from '@variance-authority/core';

/**
 * What a subject can ask of a page that is already open, and what it cannot.
 *
 * Here rather than in either collector because it is a fact about a **browser
 * context**, not about routes or stories: width and height are a resize, and a
 * device scale factor or a colour scheme is decided when the context is created.
 * Both collectors have to refuse the second kind in the same words, because the
 * failure they are refusing is the same one — a subject painted at the run's
 * viewport while recording its own produces a baseline whose environment key
 * describes a render that never happened, and every verdict over it is green.
 */

/**
 * Why this subject cannot be read in the page the run opened, or `undefined`.
 *
 * Width and height are a resize. A device scale factor or a colour scheme is a
 * property of the browser *context*, decided when it was created, and a run that
 * quietly painted at the wrong one while recording the requested value would
 * produce a baseline whose key describes a render that never happened.
 */
export function unresizable(wanted: Viewport, run: Viewport): string | undefined {
  if (wanted.deviceScaleFactor !== run.deviceScaleFactor) {
    return (
      `this subject asks for deviceScaleFactor ${wanted.deviceScaleFactor} and the run opened ` +
      `its browser at ${run.deviceScaleFactor}. A scale factor is fixed when the browser ` +
      'context is created, so it cannot be changed per subject — run it as its own run rather ' +
      'than recording a key for a render that did not happen'
    );
  }

  if (wanted.colorScheme !== run.colorScheme) {
    return (
      `this subject asks for the ${wanted.colorScheme} colour scheme and the run opened its ` +
      `browser in ${run.colorScheme}. A colour scheme is fixed when the browser context is ` +
      'created, so it cannot be changed per subject'
    );
  }

  return undefined;
}
