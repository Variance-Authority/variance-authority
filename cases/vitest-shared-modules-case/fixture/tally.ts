import { registerResetHandler } from '@variance-authority/ioc/reset';

// State whose module says how to reset it: ioc's to run before each test.
let total = 0;

registerResetHandler(() => {
  total = 0;
});

export const add = (amount: number): number => (total += amount);
