import { describe, expect, it } from 'vitest';
import { behindCut, inlineBehindCut } from './cut-map.js';

// `{\n  go();\n}` cut as `{\n  __vaC(2);go();\n}`: nine units inserted at
// line 1, column 2. The wrapped transformer's segments name the cut text's
// columns 2 (the call), 11 (`go`) and 13 (`(`).
const shifts = [1, 2, 9];
const cut = 'AAAA;EACE,SAAS,EAAE';
const written = 'AAAA;EACE,SAAA,EAAE';

// Split, or Vite reads the comment as this file's own map.
const marker = ['//#', 'sourceMappingURL'].join(' ');
const inline = (map: object): string =>
  `${marker}=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;

describe('behindCut', () => {
  it('moves a column after an insertion back, and one inside it to where it went', () => {
    expect(behindCut({ version: 3, mappings: cut }, shifts)).toEqual({ version: 3, mappings: written });
  });

  it('leaves a map of a file nothing was inserted into as it was', () => {
    expect(behindCut({ mappings: cut }, [])).toEqual({ mappings: cut });
  });

  it('reads and writes a map handed over as JSON text', () => {
    const map = JSON.parse(behindCut(JSON.stringify({ version: 3, names: ['go'], mappings: cut }), shifts)) as unknown;
    expect(map).toEqual({ version: 3, names: ['go'], mappings: written });
  });
});

describe('inlineBehindCut', () => {
  it('moves back the map a transformer left inline, as @swc/jest does', () => {
    const code = `go();\n${inline({ version: 3, mappings: cut })}\n`;
    expect(inlineBehindCut(code, shifts)).toBe(`go();\n${inline({ version: 3, mappings: written })}\n`);
  });

  it('leaves code without an inline map as it was', () => {
    const code = `go();\n${marker}=go.js.map\n`;
    expect(inlineBehindCut(code, shifts)).toBe(code);
  });
});
