/**
 * The spec's running example: *"`Button` (variant prop change) → propagated to
 * `NewHero`"* (§1). It is in the corpus to be the thing at the *bottom* of an
 * attribution chain — a change here has to surface as one root with `Hero` listed
 * as collateral, not as two independent diffs.
 *
 * It is styled entirely through the generated-class runtime, deliberately. Button
 * is the most-reused component in any library, so it is the one whose class names
 * churn most often for reasons that have nothing to do with Button, and it is
 * where "we dropped class attributes instead of pattern-matching them"
 * (ADR-0003) has to hold or the whole approach fails on the first real repo.
 *
 * Every value routes through a token so that a single token edit reaches Button
 * without any Button source change — the P2 shape.
 */

import type { ReactNode } from 'react';
import { useCss } from '../cruft/css-runtime.js';
import { box, radius, useSpelling } from '../cruft/spelling.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly disabled?: boolean | undefined;
  readonly children: ReactNode;
}

const VARIANT_DECLARATIONS: Record<ButtonVariant, string> = {
  primary: 'background-color:var(--va-color-accent);color:var(--va-color-accent-ink);border-style:none;',
  secondary:
    'background-color:var(--va-color-surface);color:var(--va-color-accent);border:1px solid var(--va-color-border);',
  ghost: 'background-color:transparent;color:var(--va-color-accent);border-style:none;',
};

const SIZE_TOKENS: Record<ButtonSize, { readonly y: string; readonly x: string; readonly font: string }> = {
  sm: { y: 'var(--va-space-1)', x: 'var(--va-space-2)', font: 'var(--va-font-size-sm)' },
  md: { y: 'var(--va-space-2)', x: 'var(--va-space-3)', font: 'var(--va-font-size-md)' },
  lg: { y: 'var(--va-space-3)', x: 'var(--va-space-4)', font: 'var(--va-font-size-lg)' },
};

export function Button({ variant = 'primary', size = 'md', disabled, children }: ButtonProps) {
  const css = useCss();
  const spelling = useSpelling();
  const sizing = SIZE_TOKENS[size];

  const base = css(
    `display:inline-flex;align-items:center;justify-content:center;font-family:var(--va-font-sans);line-height:var(--va-line-height);${radius(spelling, 'var(--va-radius-md)')}`,
  );
  const tone = css(VARIANT_DECLARATIONS[variant]);
  const scale = css(`${box('padding', spelling, sizing.y, sizing.x)}font-size:${sizing.font};`);

  return (
    <button type="button" className={`${base} ${tone} ${scale}`} disabled={disabled}>
      {children}
    </button>
  );
}

Button.displayName = 'Button';
