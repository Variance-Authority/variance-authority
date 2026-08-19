import { ActionButton } from './action-button.js';
import { Heading } from './heading.js';
import { SidePanel } from './side-panel.js';

export type Variant = 'base' | 'heading-style' | 'layout' | 'structure';

export function Workspace({ structural }: { readonly structural: boolean }) {
  return (
    <main style={{ display: 'flex', gap: '24px', padding: '16px' }}>
      <SidePanel structural={structural}>
        <Heading />
        <ActionButton />
      </SidePanel>
      <section aria-label="Content">Select a workspace item.</section>
    </main>
  );
}
