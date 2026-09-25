// The driver's half of a journey: one id per test execution, set as the cookie the
// service's filter reads, and a table of which spec each id was. The table is the
// only thing the driver writes; the id never names the spec on the wire.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  context: async ({ context, baseURL }, use, testInfo) => {
    const journey = randomUUID();
    await context.addCookies([{ name: 'variance-authority-journey', value: journey, url: baseURL }]);
    appendFileSync(process.env.VA_JOURNEYS, `${journey}\t${relative(process.cwd(), testInfo.file)}\n`);
    await use(context);
  },
});

export { expect };
