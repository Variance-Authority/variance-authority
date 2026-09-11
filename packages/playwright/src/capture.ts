import type { Page } from 'playwright';
import type { ScreenshotOptions, Viewport } from '@variance-authority/core/format';
import { SUBJECT_PATH } from '@variance-authority/raster';

/**
 * The subject's pixels and its box, by the cheapest route that produces the same
 * bytes the element path produces.
 *
 * `locator.screenshot()` does not just capture. It first runs Playwright's
 * actionability wait, which requires the subject's box to hold still across two
 * consecutive animation frames — about 30 ms at 60 Hz, charged once per subject
 * whether or not anything on the page is moving. Measured by this package's own
 * benchmark (`yarn workspace @variance-authority/playwright host`), that wait is
 * most of a light subject's cost. Median ms per paint on macOS, one page reused:
 *
 *   engine     element   clip
 *   chromium      59.2   26.2
 *   firefox       33.3    8.5
 *   webkit        33.3    3.7
 *
 * We have already settled the page ourselves — the recipe's waits have run, fonts
 * have loaded, and every network channel is blocked for the whole lease — so the
 * wait re-establishes something we have just established, at the price of the
 * paint. It is also why the engines looked closer together than they are: a
 * constant every engine pays compressed a 7x spread into a 1.8x one. The
 * benchmark's heavy-subject arm shows what that concealed — WebKit is first on
 * the subject above and last on one that rasterizes — so the saving here is not
 * uniform across engines and is largest exactly where the paint is cheapest.
 *
 * The two paths are byte-identical only if the clip is rounded the way the
 * element path rounds it: see {@link outward}. Verified across 240 randomly
 * generated subjects — fractional sizes, fractional offsets, borders, shadows,
 * axis-aligned transforms — in all three engines at both device scale factors.
 *
 * Three subjects keep the slow path, which is why this is a fallback and not a
 * replacement. Each was measured, not assumed:
 *
 * - **No reported box.** Detached, or `display: none`. There is no rectangle to
 *   clip to, and the element path is left to raise its own error for it.
 * - **Not wholly inside the viewport.** A clip rect is viewport-relative and
 *   Playwright refuses one that leaves it — a subject below the fold throws
 *   `Clipped area is either empty or outside the resulting image` in all three
 *   engines — while an oversized subject would come back silently truncated. The
 *   element path scrolls and captures beyond the viewport, so it takes these.
 * - **Rotated or skewed.** The reported box is then not the rectangle the element
 *   path captures, and the two disagree by a pixel or two on every edge.
 *
 * The transform test reads the composed matrix rather than the declared string,
 * so a rotation reached through any spelling — `rotate`, `skew`, `matrix`, a
 * shorthand — is caught by one check. It is deliberately conservative:
 * `rotate(90deg)` is axis-aligned in its result but still takes the slow path,
 * because being wrong here rewrites every baseline a user owns.
 *
 * Animation handling is unchanged and still the browser's: the recipe's
 * `animations: 'disabled'` is passed to whichever path runs. It fast-forwards a
 * finite animation to completion — the state a user comes to rest on — and
 * cancels an infinite one to its initial frame. Injected CSS can only pin frame
 * zero, which captures a fade-in at the moment it is invisible.
 *
 * The box is returned rather than left to the caller because the fast path needs
 * it first, and reading it twice would be two protocol round trips for one fact.
 * A null box — a subject that laid out to nothing — is handed to the element
 * path, which already has the wording for it.
 */
export async function captureSubject(
  page: Page,
  viewport: Viewport,
  options: ScreenshotOptions & { readonly type: 'png' },
): Promise<{ bytes: Buffer; box: Box | null }> {
  const selector = `[data-va-path="${SUBJECT_PATH}"]`;
  const subject = page.locator(selector);
  const box = await subject.boundingBox();

  if (box !== null && within(box, viewport) && (await page.evaluate(probeAxisAligned, selector))) {
    return { bytes: await page.screenshot({ ...options, clip: outward(box) }), box };
  }

  return { bytes: await subject.screenshot(options), box };
}

/** A rectangle as Playwright reports it, in CSS pixels relative to the viewport. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Whether the whole subject is on screen.
 *
 * Position and not merely size, because a clip rect that leaves the viewport is
 * refused rather than clamped. Compared in CSS pixels, which is what both the box
 * and the viewport are in — the device scale factor cancels, scaling the clip and
 * the captured surface by the same amount.
 */
function within(box: Box, viewport: Viewport): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

/**
 * A fractional box snapped to the pixel grid the way the element path snaps it:
 * floor the near edge, ceil the far one, and take everything between.
 *
 * This is the union of the pixels the subject touches — what a compositor's
 * damage rect is — and it is the only rounding of the five tried that reproduces
 * the element path's bytes. Rounding the *extent* instead of the far *edge* is
 * the tempting mistake: the two differ whenever a box starts at a fraction, which
 * includes a box of integer size sitting at a fractional offset.
 */
export function outward(box: Box): Box {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return {
    x,
    y,
    width: Math.ceil(box.x + box.width) - x,
    height: Math.ceil(box.y + box.height) - y,
  };
}

/**
 * Whether the subject reaches the screen without rotation or skew.
 *
 * Runs in the page, so it is written as a standalone function with no closure
 * over anything in this module. Walks to the root because a transform on an
 * ancestor moves the subject just as well as one on the subject itself.
 *
 * `b` and `c` are the off-diagonal terms of the 2-D matrix: zero for any
 * composition of translation and scale, non-zero the moment a rotation or skew
 * enters.
 */
function probeAxisAligned(selector: string): boolean {
  const start = window.document.querySelector(selector);
  if (start === null) return false;

  for (
    let node: Element | null = start;
    node !== null && node !== window.document.documentElement;
    node = node.parentElement
  ) {
    const transform = window.getComputedStyle(node).transform;
    if (transform === 'none' || transform === '') continue;
    const matrix = new DOMMatrixReadOnly(transform);
    if (matrix.b !== 0 || matrix.c !== 0) return false;
  }

  return true;
}
