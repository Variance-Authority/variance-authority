/**
 * What an intervention is, as a shape.
 *
 * Beside [`stabilize.ts`](./stabilize.ts), which argues why the set is open and
 * then fills it. This file is the declaration that argument depends on: an id, a
 * tier, a property it claims, and the three ways it can reach a page. A trick
 * from another project is one of these and nothing more, so the shape is worth
 * reading without reading the tricks.
 */

import type { Tier } from './tier.js';

/** What kind of move it is, for reading a recipe at a glance. */
export type Trick =
  /** Puts the page into a known state. */
  | 'reset'
  /** Stops something that would otherwise keep moving. */
  | 'hold'
  /** Blocks until something outside the page's control has landed. */
  | 'wait'
  /** Removes something that is present but must not be measured. */
  | 'support';

/** Screenshot options a trick contributes. Narrow on purpose. */
export interface ScreenshotOptions {
  readonly animations?: 'disabled';
  readonly caret?: 'hide';
}

/** The page surface a `settle` step may use. Structural, so no driver leaks in. */
export interface SettleTarget {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}

/**
 * The page's globals, as the little of them a settle step needs.
 *
 * A settle closure is the one place in `core` that reads a live document, and it
 * gets away with it because it never runs here: it is handed to
 * {@link SettleTarget.evaluate}, which ships it into a page. ADR-0001's
 * enforcement is `core`'s `tsconfig`, which has no `lib.dom` — so writing
 * `window.document.fonts` is a compile error and this shape is what remains.
 *
 * That is a stricter arrangement than the convention it replaced, not a
 * loophole. Everything a settle step may touch is enumerated here, in one
 * declaration a reader can check, and a trick that wants more of the DOM has to
 * widen it in public rather than reach for an ambient global.
 */
export interface PageGlobals {
  readonly document: {
    readonly fonts?: { readonly ready: Promise<unknown> };
    readonly images: ArrayLike<{
      readonly complete: boolean;
      readonly currentSrc: string;
      readonly src: string;
      loading: string;
      addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
    }>;
  };
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Intervention {
  /**
   * Stable identifier, and part of the recipe's digest.
   *
   * Renaming one is therefore a new identity, which is correct: a reader
   * comparing two runs has no way to know that `hold-animations` and
   * `pause-animations` were the same trick.
   */
  readonly id: string;
  readonly trick: Trick;
  readonly needs: Tier;
  /** What it does and what it costs, in one sentence a report can print. */
  readonly because: string;

  /**
   * The property this trick governs.
   *
   * Two tricks claiming one subject are in conflict — pinning animations in CSS
   * while asking the compositor to fast-forward them applies both, and the CSS
   * wins silently. See {@link conflicts}.
   */
  readonly governs: string;

  readonly css?: string;
  readonly screenshot?: ScreenshotOptions;
  readonly settle?: (target: SettleTarget) => Promise<void>;
}
