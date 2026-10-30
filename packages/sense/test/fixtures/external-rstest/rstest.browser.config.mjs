import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
}

// Every test file runs in a page Playwright launches: Rstest's browser mode.
export default withTestSelection(
  {
    root,
    include: ['test/*.browser.ts'],
    browser: { enabled: true, provider: 'playwright', browser: 'chromium', headless: true },
  },
  { coverageFile, include: (file) => file.startsWith(source) },
);
