import { test as base, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

export const test = base.extend(varianceFixtures);
export { expect };
