// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attention, EyesLog } from './access.js';
import { watch } from './rtl.js';

afterEach(cleanup);

/**
 * One journal carries queries, document events and commit evidence together.
 * These assertions are about one channel at a time, and the count each of them
 * makes is the claim: `within()` binds a different query object, so a second
 * `rtl-query` here would mean this entry point had reached past `screen`.
 */
function of(log: EyesLog, kind: Attention['kind']): readonly Attention[] {
  return log.seen.filter((entry) => entry.kind === kind);
}

function Panel(): React.ReactElement {
  return (
    <main aria-label="Drawing tools">
      <button type="button">Redraw</button>
    </main>
  );
}

function SelfRemoving(): React.ReactElement {
  const [removed, setRemoved] = useState(false);
  if (removed) return <p>Removed</p>;
  return (
    <button type="button" onClick={() => setRemoved(true)}>
      Remove me
    </button>
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
    expect(of(attention.log, 'rtl-query')).toHaveLength(1);
    expect(of(attention.log, 'rtl-query')[0]).toMatchObject({
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
    expect(of(attention.log, 'rtl-query')).toHaveLength(1);
    attention.close();
  });

  it('records absence and thrown queries without changing their result', () => {
    const attention = watch(screen);
    render(<Panel />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(() => screen.getByRole('dialog')).toThrow();

    expect(
      of(attention.log, 'rtl-query').map((entry) => entry.kind === 'rtl-query' && entry.outcome),
    ).toEqual(['absent', 'threw']);
    attention.close();
  });

  it('observes findBy before the caller continuation and returns the original promise', async () => {
    const attention = watch(screen);
    render(<Panel />);

    const promise = screen.findByRole('button', { name: 'Redraw' });
    const button = await promise;

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(of(attention.log, 'rtl-query')).toMatchObject([
      {
        kind: 'rtl-query',
        query: 'findByRole',
        outcome: 'resolved',
        targets: [{ provenance: { status: 'resolved' } }],
      },
    ]);
    attention.close();
  });

  it('copies attribution before a click handler removes the element it fired on', () => {
    const attention = watch(screen);
    render(<SelfRemoving />);

    const button = screen.getByRole('button', { name: 'Remove me' });
    fireEvent.click(button);

    expect(button.isConnected).toBe(false);
    expect(of(attention.log, 'document-event')).toMatchObject([
      {
        kind: 'document-event',
        event: 'click',
        trusted: false,
        target: {
          nodeName: 'button',
          provenance: { status: 'resolved' },
        },
      },
    ]);
    attention.close();
  });

  it('records why no commit can arrive, rather than leaving the log silent', () => {
    // No hook in this realm, and `react-dom` has already bound whatever it found
    // by the time this file imports `screen`. `rtl-commits.test.tsx` is the same
    // subject arranged the way a setup file arranges it.
    const attention = watch(screen);

    expect(of(attention.log, 'react-tap-refused')).toMatchObject([
      { kind: 'react-tap-refused', reason: 'no-hook' },
    ]);
    attention.close();
  });

  it('shares one mutation across setup-style subscribers and restores it once', () => {
    const original = screen.getByRole;
    const first = watch(screen);
    const second = watch(screen);
    render(<Panel />);

    screen.getByRole('button', { name: 'Redraw' });
    expect(of(first.log, 'rtl-query')).toHaveLength(1);
    expect(of(second.log, 'rtl-query')).toHaveLength(1);

    // The second subscriber joined after the tap refused, and still learns it.
    expect(of(second.log, 'react-tap-refused')).toHaveLength(1);

    first.close();
    expect(screen.getByRole).not.toBe(original);
    second.close();
    expect(screen.getByRole).toBe(original);
  });

  it('stops listening on the document when the last log closes', () => {
    const first = watch(screen);
    const second = watch(screen);
    render(<Panel />);
    const button = screen.getByRole('button', { name: 'Redraw' });

    first.close();
    fireEvent.click(button);
    expect(of(second.log, 'document-event')).toHaveLength(1);

    second.close();
    fireEvent.click(button);
    expect(of(second.log, 'document-event')).toHaveLength(1);
  });
});
