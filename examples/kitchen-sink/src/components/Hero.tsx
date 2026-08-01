/**
 * The root-vs-collateral fixture (spec §6.2): a composition that consumes `Button`
 * and `Card` without owning any styling of its own.
 *
 * The claim being measured is P2 — *a real change produces exactly one root plus
 * counted collateral*. Hero is built so that a one-line token edit lands in seven
 * places across three components with a single cause, which is the shape that
 * makes "1 token change, 300 collateral, structure intact" a single review action
 * rather than 300.
 *
 * `--va-space-3` was chosen for the wide-collateral case because it is consumed by
 * Hero's own row gap, by both Buttons' horizontal padding, and by the Field inside
 * the Card. `--va-color-accent` was chosen for the narrow one: it reaches the
 * primary Button's background and the secondary Button's text, and nothing else.
 * A corpus where every token has the same fan-out cannot tell a differ that counts
 * collateral correctly from one that reports "everything" every time.
 *
 * Hero deliberately declares no styles through the CSS-in-JS runtime. When the
 * class-churn variant renames every generated class, Hero's own markup is
 * untouched, so any hash movement localizes to its children — the composition is
 * the control group for its own parts.
 */

import { Button } from './Button.js';
import { Card } from './Card.js';
import { Field } from './Field.js';

export interface HeroProps {
  readonly title: string;
  /** Flips the primary action's variant. A prop change at a boundary: the root is
   * Hero (the prop provider), not Button, even though Button's styles are what
   * moved. Spec §6.2, second bullet. */
  readonly primaryVariant?: 'primary' | 'secondary' | undefined;
  /** Adds a third action. Node insertion inside a flex row: `geometry`. */
  readonly withTertiaryAction?: boolean | undefined;
}

export function Hero({ title, primaryVariant = 'primary', withTertiaryAction }: HeroProps) {
  return (
    <div className="ks-hero">
      <h1 className="ks-hero__title">{title}</h1>
      <Card title="Plan details">
        <Field label="Seats" help="Billed monthly per seat." value="12" />
      </Card>
      <div className="ks-hero__actions">
        <Button variant={primaryVariant} size="md">
          Continue
        </Button>
        <Button variant="secondary" size="md">
          Back
        </Button>
        {withTertiaryAction ? (
          <Button variant="ghost" size="md">
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

Hero.displayName = 'Hero';
