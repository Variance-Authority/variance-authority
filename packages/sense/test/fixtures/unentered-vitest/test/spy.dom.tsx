// @vitest-environment jsdom

// The same shape reached the other way: `formatTotal` is imported and a spy
// answers in its place, so the module is loaded and its one function never
// runs. Nothing about the import statement says so.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import * as totals from '../src/format-total.js';
import { Receipt } from '../src/receipt.js';

it('renders whatever the spy returns', () => {
  vi.spyOn(totals, 'formatTotal').mockReturnValue('nothing owing');
  expect(renderToStaticMarkup(<Receipt cents={1234} />)).toContain('nothing owing');
});
