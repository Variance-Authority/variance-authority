import { expect, it } from 'vitest';
import { awaited } from '../src/forms.js';

it('rejects on a missing argument', async () => {
  await expect(awaited('label')).rejects.toThrow(TypeError);
});
