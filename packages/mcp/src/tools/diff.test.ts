import { describe, expect, it } from 'vitest';
import { diffState } from './diff.js';

describe('state diff', () => {
  it('distinguishes added, removed and changed values', () => {
    expect(
      diffState(
        { kept: true, removed: 'before', nested: { value: 1 } },
        { kept: true, added: 'after', nested: { value: 2 } },
      ),
    ).toEqual([
      { kind: 'added', path: '$.added', value: 'after' },
      { kind: 'changed', path: '$.nested.value', before: 1, after: 2 },
      { kind: 'removed', path: '$.removed', value: 'before' },
    ]);
  });

  it('reports no difference for equal states', () => {
    expect(diffState({ execution: ['one', 'two'] }, { execution: ['one', 'two'] })).toEqual([]);
  });

  it('names array positions and non-identifier properties without losing either', () => {
    expect(diffState({ 'call stack': ['a'] }, { 'call stack': ['a', 'b'] })).toEqual([
      { kind: 'added', path: '$["call stack"][1]', value: 'b' },
    ]);
  });
});
