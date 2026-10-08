import { describe, expect, it } from 'vitest';
import { indexDeclarations } from './declarations.js';

/**
 * The component index a caller builds from source text it holds: the names the
 * module reader finds declared, each at the line of the statement that declares
 * it, so attribution can name `file:line`.
 */

describe('indexDeclarations', () => {
  it('indexes what the code declares, at its line, and nothing a comment spells', () => {
    const source = [
      '/*',
      'export function Retired() { return null; }',
      '*/',
      'export function Button() { return null; }',
      'export const Clock = () => null;',
      'class Panel {}',
      'function helper() { const Inner = 1; return Inner; }',
    ].join('\n');

    expect(indexDeclarations('src/Button.tsx', source)).toEqual({
      Button: [{ file: 'src/Button.tsx', line: 4, via: 'function' }],
      Clock: [{ file: 'src/Button.tsx', line: 5, via: 'const' }],
      Panel: [{ file: 'src/Button.tsx', line: 6, via: 'class' }],
    });
  });

  it('indexes a name once, at the first statement that declares it', () => {
    const source = 'function Overloaded(a: string): void;\nfunction Overloaded(a: unknown) {}\n';
    expect(indexDeclarations('src/Overloaded.ts', source)).toEqual({
      Overloaded: [{ file: 'src/Overloaded.ts', line: 1, via: 'function' }],
    });
  });

  it('places a decorated class and a second declarator at the line their statement starts on', () => {
    const decorated = '@sealed\nclass Decorated {}\nexport @sealed\nclass Two {}\n';
    expect(indexDeclarations('src/Decorated.ts', decorated)).toEqual({
      Decorated: [{ file: 'src/Decorated.ts', line: 1, via: 'class' }],
      Two: [{ file: 'src/Decorated.ts', line: 3, via: 'class' }],
    });

    // A decorator above `export` is outside the statement, which starts at `export`.
    expect(indexDeclarations('src/Three.ts', '@sealed\nexport class Three {}\n')).toEqual({
      Three: [{ file: 'src/Three.ts', line: 2, via: 'class' }],
    });

    const declarators = 'export const First = 1,\n  Second = 2;\n';
    expect(indexDeclarations('src/Declarators.ts', declarators)).toEqual({
      First: [{ file: 'src/Declarators.ts', line: 1, via: 'const' }],
      Second: [{ file: 'src/Declarators.ts', line: 1, via: 'const' }],
    });
  });

  it('indexes nothing from a file the parser cannot read', () => {
    const source = '// @flow\ntype Props = {| label: string |};\nexport function Button(props: Props) { return null; }\n';
    expect(indexDeclarations('src/Button.js', source)).toEqual({});
  });
});
