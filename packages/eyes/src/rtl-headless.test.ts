// The default `node` environment, on purpose. A runner with no DOM still runs
// queries worth recording, and reaching for `document` to install listeners
// would take the query record down with it.

import { describe, expect, it } from 'vitest';
import { watch } from './rtl.js';

describe('RTL screen attention without a DOM', () => {
  it('records queries where there is no document to listen on', () => {
    const screen = { queryByRole: (_role: string): unknown => null };
    const attention = watch(screen);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(attention.log.seen.filter((entry) => entry.kind === 'rtl-query')).toMatchObject([
      { kind: 'rtl-query', query: 'queryByRole', arguments: ['dialog'], outcome: 'absent' },
    ]);
    expect(attention.log.seen.filter((entry) => entry.kind === 'react-tap-refused')).toMatchObject([
      { kind: 'react-tap-refused', reason: 'no-hook' },
    ]);
    attention.close();
  });
});
