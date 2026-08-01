/**
 * The subjects: what gets rendered, given a variant.
 *
 * A subject is a fixed composition; everything that varies between renders comes
 * from the {@link Perturbation}. Keeping the props here rather than in the corpus
 * table means a case can name `(subject, variant)` and nothing else, so two cases
 * over the same subject are guaranteed to differ only by their variant — the
 * precondition for reading a hash movement as evidence about that variant.
 */

import type { ReactNode } from 'react';
import { Button } from './components/Button.js';
import { Card } from './components/Card.js';
import { Dialog } from './components/Dialog.js';
import { Field } from './components/Field.js';
import { Hero } from './components/Hero.js';
import { ItemList } from './components/ItemList.js';
import { Tabs } from './components/Tabs.js';
import { Wrappers } from './components/Wrappers.js';
import type { Perturbation } from './variants.js';

export interface SubjectContext {
  /** Portal target, outside the subject container. Only `dialog` uses it. */
  readonly portalHost: HTMLElement;
}

const TABS = [
  { label: 'Overview', content: 'Everything at a glance.' },
  { label: 'Usage', content: 'How the seats are being used.' },
  { label: 'Billing', content: 'Invoices and payment method.' },
] as const;

export const SUBJECTS = {
  /** Bottom of the attribution chain; the only subject styled purely by generated
   * classes. */
  button: (p: Perturbation): ReactNode => (
    <Button variant={p.props.buttonVariant} size={p.props.buttonSize}>
      Continue
    </Button>
  ),

  /** Two-level custom-property indirection and the cascade targets the accreted
   * CSS fixtures aim at. */
  card: (p: Perturbation): ReactNode => (
    <Card title="Plan details" asRegion={p.props.cardAsRegion}>
      Seats renew on the first of each month.
    </Card>
  ),

  /** Structural id aliasing: three references over two generated values. */
  field: (p: Perturbation): ReactNode => (
    <Field
      label="Seats"
      help="Billed monthly per seat."
      value="12"
      breakAssociation={p.props.fieldBreakAssociation}
      withError={p.props.fieldWithError}
    />
  ),

  /** Portal: the subtree boundary is ambiguous here and nowhere else. */
  dialog: (p: Perturbation, ctx: SubjectContext): ReactNode => (
    <Dialog
      open={p.props.dialogOpen}
      title="Confirm plan change"
      host={ctx.portalHost}
      summary="You are moving from 8 seats to 12."
    >
      <Card title="New total">$144 / month</Card>
    </Dialog>
  ),

  /** ARIA state and reference *lists*. */
  tabs: (p: Perturbation): ReactNode => (
    <Tabs tabs={TABS} selected={p.props.tabsSelected} stripPanelRole={p.props.tabsStripPanelRole} />
  ),

  /** Positional addressing under reorder, insertion, and relabel. */
  list: (p: Perturbation): ReactNode => <ItemList items={p.props.listItems} />,

  /** Composition: one token edit, several components, one root. */
  hero: (p: Perturbation): ReactNode => (
    <Hero
      title="Upgrade your workspace"
      primaryVariant={p.props.heroPrimaryVariant}
      withTertiaryAction={p.props.heroTertiaryAction}
    />
  ),

  /** Wrapper collapse, in two formatting contexts that disagree about whether a
   * `<div>` is inert. */
  wrappers: (p: Perturbation): ReactNode => (
    <Wrappers depth={p.wrapper.depth} display={p.wrapper.display} target={p.wrapper.target} />
  ),
} as const satisfies Record<string, (p: Perturbation, ctx: SubjectContext) => ReactNode>;

export type SubjectId = keyof typeof SUBJECTS;

export const SUBJECT_IDS = Object.keys(SUBJECTS) as readonly SubjectId[];
