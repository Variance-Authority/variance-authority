import { expect, it } from 'vitest';
import { arrow } from '../src/forms.js';

it('throws on a missing argument', () => {
  expect(() => arrow('label')).toThrow(TypeError);
});
