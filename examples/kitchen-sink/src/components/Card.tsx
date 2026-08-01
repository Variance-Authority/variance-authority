/**
 * Token-keyed attribution, made two levels deep on purpose.
 *
 * Card resolves its padding, radius and shadow through *component-scoped* custom
 * properties (`--ks-card-padding`) that fall back to *system* tokens
 * (`--va-space-4`). That indirection is how real design systems are built and it
 * is the case the snapshot format's `tokens` map (`snapshot.ts`) has to survive:
 * the resolved value is `16px` either way, but the docket sentence differs — "the
 * system spacing scale moved" is one root with wide collateral, while "this Card's
 * override moved" is a local change. Recording only the resolved value collapses
 * those two into the same diff and loses the sentence the product sells.
 *
 * It also carries the two class hooks the accreted-CSS fixtures aim at:
 * `.ks-card__body` is styled at specificity (0,2,0) by the components sheet so a
 * noise rule can be built to lose to it, or to tie and win on document order.
 */

import type { ReactNode } from 'react';
import { useCss } from '../cruft/css-runtime.js';
import { box, radius, useSpelling } from '../cruft/spelling.js';

export interface CardProps {
  readonly title?: string | undefined;
  readonly children: ReactNode;
  /** Renders `<section role="region">` instead of `<div>`. Used by the role-swap
   * variant: a change in accessible role is `geometry`, never `token`, even
   * though not one pixel need move. */
  readonly asRegion?: boolean | undefined;
}

export function Card({ title, children, asRegion }: CardProps) {
  const css = useCss();
  const spelling = useSpelling();

  const shell = css(
    `${box('padding', spelling, 'var(--ks-card-padding, var(--va-space-4))', 'var(--ks-card-padding, var(--va-space-4))')}${radius(spelling, 'var(--ks-card-radius, var(--va-radius-md))')}box-shadow:var(--ks-card-shadow, var(--va-shadow-1));`,
  );

  const body = (
    <>
      {title === undefined ? null : <h3 className="ks-card__title">{title}</h3>}
      <div className="ks-card__body">{children}</div>
    </>
  );

  if (asRegion) {
    return (
      <section className={`ks-card ${shell}`} aria-label={title ?? 'card'}>
        {body}
      </section>
    );
  }
  return <div className={`ks-card ${shell}`}>{body}</div>;
}

Card.displayName = 'Card';
