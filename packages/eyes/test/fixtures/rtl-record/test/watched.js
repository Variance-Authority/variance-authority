import { cleanup, screen } from '@testing-library/react';
import { watchTest } from '@variance-authority/eyes/rtl';

// Opened before each case and closed after it, the way a suite composes Eyes
// once for every test: the journal is handed over in `afterEach`, after the
// case's body has settled.
let attention;
beforeEach(() => {
  attention = watchTest(screen);
});
afterEach(() => {
  attention.close();
  cleanup();
});
