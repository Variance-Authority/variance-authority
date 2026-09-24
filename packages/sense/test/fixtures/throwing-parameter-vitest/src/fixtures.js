import { test as base } from 'vitest';

export const test = base.extend({
  greeting: async ({ task }, use) => {
    await use(`hello ${task.name}`);
  },
});
