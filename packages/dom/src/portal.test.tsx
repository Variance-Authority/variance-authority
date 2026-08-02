// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { normalize, diffSnapshots, type Viewport } from '@variance-authority/core';
import { portalContentOf } from '@variance-authority/react';
import { collect } from './collect.js';

/**
 * ADR-0007, stated as a test.
 *
 * The corpus surfaced this: a subject whose dialog is portalled has a
 * byte-identical container whether the dialog is open or closed, because the
 * content lands on `document.body`. Reading the subject boundary as DOM
 * containment therefore reports an opening modal as `unchanged` — a false
 * negative arriving through a door ADR-0002 did not cover.
 *
 * The first test here fails without the portal provider. That is the point: it
 * asserts the bug is actually reachable, so the fix cannot rot into a no-op.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

function Dialog({ open }: { open: boolean }) {
  return (
    <div>
      <button type="button">Open</button>
      {open
        ? createPortal(
            <div role="dialog" aria-label="Confirm">
              <p>Are you sure?</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function mount(open: boolean): Element {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host')!;
  const root = createRoot(host);
  act(() => {
    root.render(<Dialog open={open} />);
  });
  return host;
}

function snapshotOf(open: boolean, withPortals: boolean) {
  const host = mount(open);
  return normalize(
    collect(host, {
      subject: { id: 'story:dialog', kind: 'fixture' },
      viewport: VIEWPORT,
      engine: 'jsdom@test',
      fonts: [],
      ...(withPortals ? { portalsOf: portalContentOf } : {}),
    }),
  );
}

describe('portalled content', () => {
  it('is invisible to a DOM-containment reading — the bug this fixes', () => {
    // Without the provider the container is identical open and closed. Recorded
    // so the failure mode stays demonstrable rather than becoming folklore.
    expect(snapshotOf(false, false).renderHash).toBe(snapshotOf(true, false).renderHash);
  });

  it('changes the hash when the dialog opens', () => {
    expect(snapshotOf(false, true).renderHash).not.toBe(snapshotOf(true, true).renderHash);
  });

  it('reports the dialog as an added node, not as an environment change', () => {
    const diff = diffSnapshots(snapshotOf(false, true), snapshotOf(true, true));
    const added = diff.deltas.filter((delta) => delta.kind === 'node-added');

    expect(added.length).toBeGreaterThan(0);
    expect(diff.deltas.some((delta) => delta.band === 'geometry')).toBe(true);
  });

  it('marks the portalled subtree so the docket can say where it rendered', () => {
    const snapshot = snapshotOf(true, true);
    const portalled = snapshot.root.children.filter((child) => child.portalled === true);

    expect(portalled).toHaveLength(1);
    expect(portalled[0]!.role).toBe('dialog');
  });

  it('warns when no portal provider was supplied', () => {
    const host = mount(true);
    const capture = collect(host, {
      subject: { id: 'story:dialog', kind: 'fixture' },
      viewport: VIEWPORT,
      engine: 'jsdom@test',
      fonts: [],
    });

    expect(capture.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'portals-not-resolved' }),
    );
  });

  it('finds nothing to warn about when the subject uses no portal', () => {
    document.body.innerHTML = '<div id="host"><button>Save</button></div>';
    expect(portalContentOf(document.getElementById('host')!)).toEqual([]);
  });
});
