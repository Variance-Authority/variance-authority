import { describe, expect, it } from 'vitest';
import { instrument, instrumentationId, instrumentModeOf, probeRecipe, type SourceConsumed } from './index.js';

const sourceConsumed = [{ module: 'compiler-kit', imported: 'declare', path: ['member'], syntax: 'arguments', arguments: [1] }] as const;
const SOURCE = `import { declare as consume } from 'compiler-kit';
const dimensions = { width: props => props.width };
const styles = { hover: dimensions };
consume.view(() => render(), styles);
list.map(value => value.color);`;

describe('declared source consumers', () => {
  it.each(['presence', 'entries'] as const)('preserves only configured source positions under %s', mode => {
    const plain = instrument(SOURCE, 'consumer.ts', 'consumer.ts', { mode })!;
    const configured = instrument(SOURCE, 'consumer.ts', 'consumer.ts', { mode, sourceConsumed })!;
    expect(plain.blocks).toHaveLength(4);
    expect(configured.blocks).toHaveLength(3);
    expect(configured.code).toContain('props => props.width');
    expect(configured.code).toMatch(/\(\) => \(__va\(/);
    expect(configured.code).toMatch(/value => \(__va\(/);
    expect(configured.instrumentation).toBe(instrumentationId(mode, sourceConsumed));
    expect(configured.instrumentation).not.toBe(plain.instrumentation);
    expect(instrumentModeOf(configured.instrumentation)).toBeUndefined();
    expect(instrumentModeOf(configured.instrumentation, sourceConsumed)).toBe(mode);
    expect(probeRecipe(mode, sourceConsumed)).not.toBe(probeRecipe(mode));
  });

  it('contains no default library recognition', () => {
    const source = "import { styled } from '@compiled/react'; styled.button({ width: props => props.width });";
    expect(instrument(source, 'consumer.ts')!.blocks).toHaveLength(2);
    expect(instrument(source, 'consumer.ts', 'consumer.ts', { sourceConsumed: [] })!.blocks).toHaveLength(2);
  });

  it('keeps arguments when their positions or callee path are not declared', () => {
    for (const rule of [
      { ...sourceConsumed[0], arguments: [] },
      { ...sourceConsumed[0], path: ['call'] as const },
    ]) expect(instrument(SOURCE, 'consumer.ts', 'consumer.ts', { sourceConsumed: [rule] })!.blocks).toHaveLength(4);
  });

  it('refuses invalid argument positions', () => {
    for (const index of [-1, 0.5]) {
      expect(() => instrument(SOURCE, 'consumer.ts', 'consumer.ts', {
        sourceConsumed: [{ ...sourceConsumed[0], arguments: [index] }],
      })).toThrow('argument indices must be nonnegative integers');
    }
  });

  it('refuses malformed consumer descriptors', () => {
    for (const rule of [
      { ...sourceConsumed[0], path: ['unknown'] },
      { ...sourceConsumed[0], syntax: 'unknown' },
      { ...sourceConsumed[0], syntax: 'template', arguments: [] },
      { ...sourceConsumed[0], module: '' },
    ]) {
      expect(() => instrument(SOURCE, 'consumer.ts', 'consumer.ts', {
        sourceConsumed: [rule as unknown as SourceConsumed],
      })).toThrow('sourceConsumed:');
    }
  });

  it('resolves configured imports by scope', () => {
    const source = "import { declare } from 'compiler-kit'; function runtime(declare) { declare.view(null, props => props.width); }";
    expect(instrument(source, 'consumer.ts', 'consumer.ts', { sourceConsumed })!.blocks).toHaveLength(3);
  });
});
