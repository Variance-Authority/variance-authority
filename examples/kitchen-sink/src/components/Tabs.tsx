/**
 * ARIA state, and a second population of generated ids that only exist to point at
 * each other.
 *
 * A tablist is where the accessibility tree carries information the DOM tree does
 * not: `aria-selected`, `aria-controls` → `role="tabpanel"`, and the hidden
 * panels. It is in the corpus for two separate reasons.
 *
 * 1. **State is `geometry`, not `token`.** Selecting a different tab moves no
 *    node and changes no resolved style on the tablist itself, but it changes what
 *    a screen reader announces and which panel exists. `bandOf('state-changed')`
 *    says `geometry`, and this fixture is what makes that classification testable
 *    under JSDOM — the profile with no layout engine at all. If JSDOM could only
 *    decide the `token` band, ADR-0002's claim that it decides "the structural half
 *    of geometry" would be unsupported.
 * 2. **`aria-controls` is a reference list**, handled by
 *    `ID_REFERENCE_LIST_ATTRIBUTES` rather than the single-value path. Tabs are the
 *    cheapest place to catch an aliaser that only rewrote single references.
 */

import { useId } from 'react';

export interface TabsProps {
  readonly tabs: readonly { readonly label: string; readonly content: string }[];
  readonly selected: number;
  /** Renders the panel as a plain `<div>` with no role. Same text, same styles,
   * same box: only the accessibility tree changes. */
  readonly stripPanelRole?: boolean | undefined;
}

export function Tabs({ tabs, selected, stripPanelRole }: TabsProps) {
  const prefix = useId();
  const tabId = (i: number) => `${prefix}tab${i}`;
  const panelId = (i: number) => `${prefix}panel${i}`;

  return (
    <div className="ks-tabs">
      <div role="tablist" className="ks-tabs__list" aria-label="Sections">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            id={tabId(i)}
            className="ks-tabs__tab"
            aria-selected={i === selected}
            aria-controls={panelId(i)}
            tabIndex={i === selected ? 0 : -1}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) =>
        i === selected ? (
          <div
            key={tab.label}
            id={panelId(i)}
            className="ks-tabs__panel"
            {...(stripPanelRole ? {} : { role: 'tabpanel', 'aria-labelledby': tabId(i) })}
          >
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

Tabs.displayName = 'Tabs';
