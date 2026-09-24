import { expect, it } from 'vitest';
import { Constructed } from '../src/forms.js';

it('throws on a missing argument', () => {
  expect(() => new Constructed('label')).toThrow(TypeError);
});
