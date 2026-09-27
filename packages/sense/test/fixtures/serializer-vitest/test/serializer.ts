// The project's own snapshot serializer. Vitest loads it once a worker, before
// any setup file, and it imports product source the seam instruments.
import { isShape, printShape } from '../src/shape.js';

export default {
  test: (value: unknown): boolean => isShape(value),
  serialize: (value: unknown): string => printShape(value as { readonly sides: number }),
};
