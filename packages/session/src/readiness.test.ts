// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubjectRef, Viewport } from '@variance-authority/core/format';
import { createSession, type Session } from './session.js';

/**
 * Nothing rendered is not the same as nothing changed.
 *
 * A subject that renders on a later tick — a lazy chunk, a resolved suspense
 * boundary, a story that awaits its fixture data — was photographed in the same
 * synchronous turn as its mount, so the collector saw an empty container. Two
 * empty containers hash identically, so such a subject reported `unchanged`
 * forever while its markup changed underneath it: a check that passes because
 * there was nothing to see, which is the failure this whole system exists to
 * make impossible.
 *
 * Two instruments here, and they are not redundant. The container must not be
 * empty when it is photographed, which catches the mount that renders nothing at
 * all and cannot be talked out of it. And the subject may *declare* when it is
 * done, which beats any wait this package could invent, because only the subject
 * knows what it is waiting for.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const subject = (id: string): SubjectRef => ({ id, kind: 'story' });

let session: Session;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  session = createSession({ document, viewport: VIEWPORT, engine: 'jsdom@test', fonts: [] });
});

afterEach(() => {
  session.dispose();
});

function mountCard(container: HTMLElement): void {
  container.innerHTML = '<div class="card"><p class="card-body">Hello</p></div>';
}

/** A subject that is not finished when `mount` returns, and says so. */
function rendersLater(html: string): (container: HTMLElement) => Promise<void> {
  return async (container) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    container.innerHTML = html;
  };
}

describe('a subject that has not rendered when mount returns', () => {
  it('sees the change between two asynchronous renders of one subject', async () => {
    // The defect, stated positively. Collected in the mount's own turn, both of
    // these photograph an empty container, compare equal, and report a subject
    // whose markup changed as unchanged — forever, since it never renders in
    // time to be seen at all.
    const first = await session.run(subject('story:card'), rendersLater('<div class="card">one</div>'));
    const second = await session.run(subject('story:card'), rendersLater('<div class="card">two</div>'));

    expect(first.snapshot.renderHash).not.toBe(second.snapshot.renderHash);
  });

  it('refuses to snapshot a subject that mounted nothing', () => {
    // An empty container is comparable to every other empty container, so a
    // snapshot of one is worse than no snapshot: it enters a baseline as a real
    // answer and then agrees with everything.
    expect(() => session.run(subject('story:ghost'), () => {})).toThrow(/empty subject/);
  });

  it('refuses to snapshot a subject whose asynchronous mount rendered nothing', async () => {
    // Awaiting the subject's own signal is not proof that it rendered — a mount
    // can settle having done nothing, and the emptiness check is what keeps the
    // async path from reintroducing the vacuous positive it was added to remove.
    await expect(session.run(subject('story:ghost'), async () => {})).rejects.toThrow(/empty subject/);
  });

  it('surfaces a mount that failed instead of snapshotting what it did not render', async () => {
    // A rejected mount used to be an unhandled rejection *and* a clean snapshot
    // of an empty container: the run reported success for a subject that threw.
    await expect(
      session.run(subject('story:broken'), async () => {
        throw new Error('fixture fetch failed');
      }),
    ).rejects.toThrow('fixture fetch failed');
  });

  it('refuses to start a subject while another is still mounting', () => {
    // One session, one container. Two subjects mounting into it at once
    // photograph each other's DOM, which is the same vacuous artifact by another
    // route — and unlike an empty container it can look plausible.
    const pending = session.run(subject('story:a'), rendersLater('<p>a</p>'));

    expect(() => session.run(subject('story:b'), mountCard)).toThrow(/still mounting/);

    return pending;
  });

  it('re-runs an asynchronous subject during verification', async () => {
    // `verify` is the tier that proves order-dependence by re-running. If it
    // could not await a replay, every asynchronous subject would be re-run into
    // an empty container and confirmed as unstable — a fabricated finding.
    await session.run(subject('story:card'), rendersLater('<div class="card">one</div>'));

    const confirmed = await session.verify((_ref, container) =>
      rendersLater('<div class="card">one</div>')(container),
    );

    expect(confirmed).toEqual([]);
  });
});

describe('what still counts as rendered', () => {
  it('keeps a synchronous mount synchronous', () => {
    // The common case pays nothing for the async path: `run` hands back the run
    // itself, not a promise for it. A sync caller that silently received a
    // promise would assert on the wrong object and pass regardless.
    const run = session.run(subject('story:card'), mountCard);

    expect(run).not.toBeInstanceOf(Promise);
    expect(run.snapshot.renderHash).toMatch(/^v1:/);
  });

  it('accepts a subject whose entire output is text', () => {
    // The refusal is about nothing being rendered, not about elements. A bare
    // string is observable — the collector captures text nodes — so refusing it
    // would be a false alarm, and false alarms are how a check gets switched off.
    const saved = session.run(subject('story:toast'), (container) => {
      container.textContent = 'Saved';
    });
    const deleted = session.run(subject('story:toast'), (container) => {
      container.textContent = 'Deleted';
    });

    expect(saved.snapshot.renderHash).not.toBe(deleted.snapshot.renderHash);
  });
});
