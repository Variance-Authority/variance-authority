import { expect, it } from 'vitest';
import { called } from '../src/forms.js';

it('throws on a missing argument', () => {
  expect(() => called('label')).toThrow(TypeError);
});
