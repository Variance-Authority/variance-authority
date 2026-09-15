// @vitest-environment jsdom

// `HeavyChart` is imported by the module under test and the branch that would
// render it is never taken. Loading `src/panel.tsx` loads `src/heavy-chart.tsx`
// with it, so a file-level reading says the test reached the chart.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Panel } from '../src/panel.js';

it('shows the empty state when there are no points', () => {
  expect(renderToStaticMarkup(<Panel points={[]} />)).toContain('Nothing to chart yet.');
});
