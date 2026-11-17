// Where a fragment's elements are, and the hands and eyes an action and a read
// get on them. The seam another runner would fill.
import type { Locator, Page } from '@playwright/test';

// ── where: a selector is data, so a probe can be listed, printed and compared ──

export type Where =
  | { readonly by: 'role'; readonly role: string; readonly name?: string }
  | { readonly by: 'label'; readonly text: string }
  | { readonly by: 'testId'; readonly id: string };

export const byRole = (role: string, name?: string): Where => ({ by: 'role', role, name });
export const byLabel = (text: string): Where => ({ by: 'label', text });
export const byTestId = (id: string): Where => ({ by: 'testId', id });

export function locate(scope: Page | Locator, where: Where): Locator {
  if (where.by === 'role') {
    return scope.getByRole(where.role as Parameters<Page['getByRole']>[0], { name: where.name, exact: true });
  }
  return where.by === 'label' ? scope.getByLabel(where.text, { exact: true }) : scope.getByTestId(where.id);
}

// ── drivers: an action gets hands, a read gets eyes only ──

export interface ReadDriver {
  text(where: Where): Promise<string>;
  texts(where: Where): Promise<string[]>;
  number(where: Where): Promise<number>;
  count(where: Where): Promise<number>;
  value(where: Where): Promise<string>;
}

export interface Driver extends ReadDriver {
  click(where: Where): Promise<void>;
  fill(where: Where, value: string): Promise<void>;
  select(where: Where, value: string): Promise<void>;
  press(where: Where, key: string): Promise<void>;
}

// Actions run against an arrived, settled region, so they never wait for one:
// a missing element is a broken contract, said at once.
const NOW = { timeout: 1_000 };

export function readDriver(scope: Locator): ReadDriver {
  const at = (where: Where) => locate(scope, where);
  return {
    text: async (where) => (await at(where).innerText(NOW)).trim(),
    texts: async (where) => (await at(where).allInnerTexts()).map((text) => text.trim()),
    number: async (where) => Number((await at(where).innerText(NOW)).trim()),
    count: (where) => at(where).count(),
    value: (where) => at(where).inputValue(NOW),
  };
}

export function driver(scope: Locator): Driver {
  const at = (where: Where) => locate(scope, where);
  return {
    ...readDriver(scope),
    click: (where) => at(where).click(NOW),
    fill: (where, value) => at(where).fill(value, NOW),
    select: async (where, value) => {
      await at(where).selectOption(value, NOW);
    },
    press: (where, key) => at(where).press(key, NOW),
  };
}
