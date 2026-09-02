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
});
