import { describe, expect, it } from 'vitest';

// Nothing here imports `src/shape.ts`: the one route to it is the serializer.
describe('shape', () => {
  it('prints a triangle through the project serializer', () => {
    expect({ sides: 3 }).toMatchInlineSnapshot(`shape: triangle`);
  });

  it('compares a number without printing one', () => {
    expect(1 + 1).toBe(2);
  });
});
