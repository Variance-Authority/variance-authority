import { describe, expect, it } from 'vitest';
import type { ExecutionModule } from '@variance-authority/sense/test-selection';
import { noFunction } from './covering-at.js';

const block = (name: string) => ({ name, kind: 'function', source: true });

describe('a function the record does not hold by the name asked', () => {
  it('names first the recorded function whose last segment is the name asked', () => {
    const module = { blocks: [block('Faste/constructor'), block('Faste/start'), block('Faste/isStarted')] } as unknown as ExecutionModule;

    expect(noFunction('src/faste.ts', 'isStarted', module).message).toContain('It has Faste/isStarted, Faste/constructor, Faste/start.');
  });

  it('keeps the recorded order when no function ends in the name asked', () => {
    const module = { blocks: [block('Faste/start'), block('Started')] } as unknown as ExecutionModule;

    expect(noFunction('src/faste.ts', 'tarted', module).message).toContain('It has Faste/start, Started.');
  });
});
