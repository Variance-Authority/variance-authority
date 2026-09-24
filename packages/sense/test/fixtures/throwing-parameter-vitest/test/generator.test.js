import { expect, it } from 'vitest';
import { generated } from '../src/forms.js';

it('throws on a missing argument when it is called, before anything iterates it', () => {
  expect(() => generated('label')).toThrow(TypeError);
});
