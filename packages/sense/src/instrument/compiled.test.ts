import { transformSync } from '@babel/core';
import compiled from '@compiled/babel-plugin';
import { describe, expect, it } from 'vitest';
import { instrument, instrumentationId } from './index.js';

const SOURCE = `import { styled as design, css } from '@compiled/react';
export const Button = design.button(
  { width: props => props.small ? '24px' : '32px' },
  props => props.active && css({ color: 'red' }),
);
export const runtime = value => value + 1;
`;

function compile(source: string): string {
  return transformSync(source, {
    filename: 'compiled-styles.tsx', configFile: false, babelrc: false,
    plugins: [compiled], parserOpts: { plugins: ['typescript', 'jsx'] },
  })!.code!;
}

function rules(source: string): readonly string[] {
  return [...source.matchAll(/"(\._[^"\n]+\{[^"\n]+\})"/g)].map(match => match[1]!);
}

describe('Compiled style declarations', () => {
  it.each([
    ['named', "import { styled, css } from '@compiled/react'; const style = props => props.active && css({color:'red'}); export const Button = styled.button(style);"],
    ['object', "import { styled } from '@compiled/react'; const styles = {width: props => props.small ? '24px' : '32px'}; export const Button = styled.button(styles);"],
    ['nested', "import { styled } from '@compiled/react'; const dimensions = {width: props => props.small ? '24px' : '32px'}; const styles = { '&:hover': dimensions }; export const Button = styled.button(styles);"],
    ['template', "import { styled } from '@compiled/react'; export const Button = styled.button`color: ${props => props.active ? 'red' : 'blue'}`;"],
    ['component', "import { styled } from '@compiled/react'; const View = props => null; export const Button = styled(View)({width: props => props.small ? '24px' : '32px'});"],
  ])('preserves %s style declarations', (name, source) => {
    const plain = rules(compile(source));
    expect(plain.length).toBeGreaterThan(0);
    for (const mode of ['entries', 'presence'] as const) {
      const probed = instrument(source, 'compiled-styles.tsx', 'compiled-styles.tsx', { mode })!;
      expect(probed.instrumentation).toBe(instrumentationId(mode));
      expect(rules(compile(probed.code))).toEqual(plain);
      if (name === 'component') expect(probed.blocks.map(block => block.name)).toEqual(['', 'View']);
    }
  });

  it.each(['entries', 'presence'] as const)('keeps dynamic style value callbacks under %s probes', mode => {
    const source = `import { styled } from '@compiled/react';
const items = [{ color: 'red' }];
export const Button = styled.button({ color: items.map(value => value.color).join(',') });`;
    expect(() => compile(source)).not.toThrow();
    const probed = instrument(source, 'compiled-styles.tsx', 'compiled-styles.tsx', { mode })!;
    expect(probed.blocks).toHaveLength(2);
    expect(probed.code).toContain('value => (__va(1),value.color)');
    expect(() => compile(probed.code)).not.toThrow();
  });

  it.each(['entries', 'presence'] as const)('preserves compiler syntax and CSS under %s probes', mode => {
    const plain = compile(SOURCE);
    const probed = instrument(SOURCE, 'compiled-styles.tsx', 'compiled-styles.tsx', { mode })!;
    expect(probed.instrumentation).toBe(instrumentationId(mode));
    expect(rules(compile(probed.code))).toEqual(rules(plain));
    expect(probed.blocks.map(block => block.name)).toEqual(['', 'runtime']);
    expect(rules(plain)).toHaveLength(3);
    expect(probed.code).toContain('value => (__va(1),value + 1)');
  });
});
