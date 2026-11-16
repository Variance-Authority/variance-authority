import { afterEach } from 'vitest';

// A library's cleanup, as `@testing-library/react` registers it on import:
// teardown no line of the test file runs.
afterEach(() => {
  document.body.innerHTML = '';
});
