// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { watch } from './rtl.js';

afterEach(cleanup);

function Panel(): React.ReactElement {
  return (
    <main aria-label="Drawing tools">
      <button type="button">Redraw</button>
    </main>
  );
}

describe('RTL screen attention', () => {
  it('captures Fiber attribution before returning the queried element', () => {
    const attention = watch(screen);
    render(<Panel />);

    const panel = screen.getByRole('main', { name: 'Drawing tools' });
    const button = within(panel).getByRole('button', { name: 'Redraw' });
    cleanup();

    expect(button.isConnected).toBe(false);
    expect(attention.log.seen).toHaveLength(1);
    expect(attention.log.seen[0]).toMatchObject({
      kind: 'rtl-query',
      query: 'getByRole',
      outcome: 'resolved',
      targets: [
        {
          nodeName: 'main',
          ariaLabel: 'Drawing tools',
          provenance: { status: 'resolved' },
        },
      ],
    });

    // `within` binds a different query object and is outside `watch(screen)`.
    expect(attention.log.seen).toHaveLength(1);
    attention.close();
  });

  it('records absence and thrown queries without changing their result', () => {
    const attention = watch(screen);
    render(<Panel />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(() => screen.getByRole('dialog')).toThrow();

    expect(attention.log.seen.map((entry) => entry.kind === 'rtl-query' && entry.outcome)).toEqual([
      'absent',
      'threw',
    ]);
    attention.close();
  });

  it('observes findBy before the caller continuation and returns the original promise', async () => {
    const attention = watch(screen);
    render(<Panel />);

    const promise = screen.findByRole('button', { name: 'Redraw' });
    const button = await promise;

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(attention.log.seen).toMatchObject([
      {
        kind: 'rtl-query',
        query: 'findByRole',
        outcome: 'resolved',
        targets: [{ provenance: { status: 'resolved' } }],
      },
    ]);
    attention.close();
  });

  it('shares one mutation across setup-style subscribers and restores it once', () => {
    const original = screen.getByRole;
    const first = watch(screen);
    const second = watch(screen);
    render(<Panel />);

    screen.getByRole('button', { name: 'Redraw' });
    expect(first.log.seen).toHaveLength(1);
    expect(second.log.seen).toHaveLength(1);

    first.close();
    expect(screen.getByRole).not.toBe(original);
    second.close();
    expect(screen.getByRole).toBe(original);
  });
});
