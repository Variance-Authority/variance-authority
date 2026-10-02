// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { watchTest } from './rtl.js';

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
type Holder = { [CASE_SCOPE]?: unknown };

const found = (globalThis as Holder)[CASE_SCOPE];
afterEach(() => {
  cleanup();
  (globalThis as Holder)[CASE_SCOPE] = found;
});

/** A recording run's scope, as a runner seam installs it while a case runs. */
function recording(): Readonly<Record<string, unknown>>[] {
  const handed: Readonly<Record<string, unknown>>[] = [];
  (globalThis as Holder)[CASE_SCOPE] = {
    root: '/work/app',
    eyes: (journal: Readonly<Record<string, unknown>>) => handed.push(journal) > 0,
  };
  return handed;
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

describe('an RTL test watched without naming it', () => {
  it('hands what it rendered, queried and clicked to the case the run is recording', () => {
    const handed = recording();
    const attention = watchTest(screen);
    render(<SelfRemoving />);
    const button = screen.getByRole('button', { name: 'Remove me' });
    fireEvent.click(button);
    const journal = attention.close();

    // The element is gone by the time the journal is handed over, and the
    // record of what the test addressed is not.
    expect(button.isConnected).toBe(false);
    expect(handed).toEqual([journal]);
    expect(journal.complete).toBe(true);
    expect(journal.attention.filter((entry) => entry.kind === 'rtl-query')).toMatchObject([
      { query: 'getByRole', outcome: 'resolved', targets: [{ nodeName: 'button', provenance: { status: 'resolved' } }] },
    ]);
    expect(journal.attention.filter((entry) => entry.kind === 'document-event')).toMatchObject([
      { event: 'click', trusted: false, target: { nodeName: 'button' } },
    ]);
    // Nothing in it names the test: the case and the attempt are the record's.
    expect(Object.keys(journal).sort()).toEqual(['attention', 'complete']);
  });

  it('hands one journal however often teardown closes it', () => {
    const handed = recording();
    const attention = watchTest(screen);
    render(<SelfRemoving />);
    expect(attention.close()).toBe(attention.close());
    expect(handed).toHaveLength(1);
  });

  it('says a journal is partial when the log had already been drained', () => {
    const handed = recording();
    const attention = watchTest(screen);
    render(<SelfRemoving />);
    screen.getByRole('button', { name: 'Remove me' });

    // What a harness that flushes mid-test does: the journal below is
    // well-formed, ordered, and missing its opening.
    expect(attention.log.drain()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove me' }));

    const journal = attention.close();
    expect(journal.complete).toBe(false);
    expect(journal.complete === false && journal.because).toContain('2 attention entries');
    expect(handed[0]).toMatchObject({ complete: false });
  });

  it('keeps the journal to itself when no run is recording', () => {
    delete (globalThis as Holder)[CASE_SCOPE];
    const attention = watchTest(screen);
    render(<SelfRemoving />);
    screen.getByRole('button', { name: 'Remove me' });
    expect(attention.close().attention.length).toBeGreaterThan(0);
  });

  it('keeps the identity it was given, and hands nothing over', () => {
    const handed = recording();
    const journal = watchTest(screen, { id: 'suite > named', title: 'named' }).close();
    expect(journal).toMatchObject({ id: 'suite > named', title: 'named', complete: true });
    expect(handed).toEqual([]);
  });
});

// FIXME: Sense's Vitest and Jest seams install a case scope with no `eyes`, so
// under `testSelectionProbes` an RTL journal reaches no record yet. The seams
// need an attempt count per case, a way to hold a journal handed over in
// `afterEach` (Vitest enters the case around the body only), and a sibling of
// the case frame the fold reads into `FreshCases.eyes`.
it.todo('an RTL journal handed over under Vitest or Jest recording lands in the record — needs a case scope in those seams that takes a journal');
