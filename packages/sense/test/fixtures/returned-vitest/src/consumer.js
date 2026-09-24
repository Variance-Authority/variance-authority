import { factory } from './factory.js';

// The factory runs while this module loads, so its body is crossed by every
// test that imports the consumer, and the function it returns is not.
export const returned = factory();
