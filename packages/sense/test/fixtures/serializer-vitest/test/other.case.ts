import { expect, it } from 'vitest';

// Never prints a shape. Its worker loads the serializer for it all the same,
// so a change to the top level of `src/shape.ts` fails this file too.
it('adds without printing', () => {
  expect(1 + 1).toBe(2);
});
