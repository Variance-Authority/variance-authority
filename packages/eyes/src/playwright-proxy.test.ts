import type { Locator, Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { createEyesLog, type TargetSnapshot } from './access.js';
import { instrumentPage } from './playwright-proxy.js';

const target: TargetSnapshot = {
  nodeName: 'button',
  type: 'button',
  provenance: { status: 'no-fiber', reason: 'no-client-fiber' },
};

describe('Playwright API-compatible proxies', () => {
  it('reinstalls document listeners after setContent replaces the document', async () => {
    const installCurrentDocument = vi.fn(async () => undefined);
    const page = {
      setContent(this: unknown, html: string) {
        expect(this).toBe(page);
        expect(html).toBe('<button>Redraw</button>');
        return Promise.resolve('loaded');
      },
    };

    const instrumented = instrumentPage(
      page as unknown as Page,
      createEyesLog(),
      vi.fn(),
      installCurrentDocument,
    );

    await expect(instrumented.setContent('<button>Redraw</button>')).resolves.toBe('loaded');
    expect(installCurrentDocument).toHaveBeenCalledOnce();
  });

  it('preserves receiver binding and observes chained actions and assertions', async () => {
    const log = createEyesLog();
    const snapshot = vi.fn(async () => [target]);

    const child = {
      click(this: unknown) {
        expect(this).toBe(child);
        return Promise.resolve('clicked');
      },
      _expect(this: unknown) {
        expect(this).toBe(child);
        return Promise.resolve({ matches: true });
      },
    };
    const root = {
      getByRole(this: unknown) {
        expect(this).toBe(root);
        return child;
      },
    };
    const page = {
      getByRole(this: unknown) {
        expect(this).toBe(page);
        return root;
      },
    };

    const instrumented = instrumentPage(
      page as unknown as Page,
      log,
      snapshot as (locator: Locator) => Promise<readonly TargetSnapshot[]>,
    );
    const locator = instrumented
      .getByRole('main', { name: 'Drawing tools' })
      .getByRole('button', { name: 'Redraw' });

    await locator.click();
    await (locator as unknown as { _expect: (matcher: string) => Promise<unknown> })._expect(
      'to.be.enabled',
    );

    expect(log.seen.map((entry) => entry.kind === 'playwright-locator' && entry.operation)).toEqual([
      'planned',
      'planned',
      'action',
      'assertion',
    ]);
    expect(log.seen[2]).toMatchObject({
      member: 'click',
      before: [target],
      after: [target],
      outcome: 'resolved',
    });
    expect(log.seen[3]).toMatchObject({
      member: 'to.be.enabled',
      before: [target],
      after: [target],
      outcome: 'resolved',
    });
    expect(snapshot).toHaveBeenCalledTimes(4);
  });

  it('runs the call and hands back its own outcome when the Locator cannot be read before it', async () => {
    const log = createEyesLog();
    const refused = new Error('expected "" not to be empty');
    let fails = false;
    const child = {
      _expect: vi.fn(() => (fails ? Promise.reject(refused) : Promise.resolve({ matches: true }))),
      click: vi.fn(() => Promise.resolve('clicked')),
    };
    const page = { getByLabel: () => child };
    const locator = instrumentPage(page as unknown as Page, log, async () => {
      throw new Error('Target page, context or browser has been closed');
    }).getByLabel('Count') as unknown as {
      _expect: (matcher: string, options: { isNot: boolean }) => Promise<unknown>;
      click: () => Promise<unknown>;
    };

    await expect(locator._expect('to.be.empty', { isNot: true })).resolves.toEqual({ matches: true });
    fails = true;
    await expect(locator._expect('to.be.empty', { isNot: true })).rejects.toBe(refused);
    await expect(locator.click()).resolves.toBe('clicked');

    expect(child._expect).toHaveBeenCalledTimes(2);
    expect(child.click).toHaveBeenCalledOnce();
    const consumed = log.seen.slice(1);
    expect(consumed).toEqual([
      expect.objectContaining({ member: 'to.be.empty', outcome: 'resolved' }),
      expect.objectContaining({ member: 'to.be.empty', outcome: 'threw', error: refused.message }),
      expect.objectContaining({ member: 'click', outcome: 'resolved' }),
    ]);
    for (const entry of consumed) expect(entry).not.toHaveProperty('before');
  });

  it('keeps a successful action passing when the post-operation read is lost', async () => {
    const log = createEyesLog();
    let reads = 0;
    const snapshot = vi.fn(async () => {
      reads += 1;
      if (reads > 1) throw new Error('Target page, context or browser has been closed');
      return [target];
    });

    const child = {
      click(this: unknown) {
        expect(this).toBe(child);
        return Promise.resolve('clicked');
      },
    };
    const page = {
      getByRole(this: unknown) {
        expect(this).toBe(page);
        return child;
      },
    };

    const instrumented = instrumentPage(
      page as unknown as Page,
      log,
      snapshot as (locator: Locator) => Promise<readonly TargetSnapshot[]>,
    );

    await expect(instrumented.getByRole('button', { name: 'Redraw' }).click()).resolves.toBe(
      'clicked',
    );

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(log.seen[1]).toMatchObject({
      member: 'click',
      before: [target],
      outcome: 'resolved',
    });
    expect(log.seen[1]).not.toHaveProperty('after');
  });
});
