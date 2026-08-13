import { describe, expect, it } from 'vitest';
import {
  inlineSourceMapOf,
  originalPositionFor,
  parseSourceMap,
  sourceMappingUrlOf,
} from './source-map.js';

/**
 * A map Vite actually served, not one written to pass this.
 *
 * Captured from `vite dev` transforming a component with no configuration at
 * all — no plugin, no `jsxImportSource`, no `jsxDev` — which is the only
 * condition under which the zero-install path is worth anything. `sourcesContent`
 * is dropped because it is the whole file and none of it is under test.
 *
 * The component it describes, with the lines that matter:
 *
 * ```
 *  4 export function Badge({ label }) {
 *  5   return <span className="badge">{label}</span>;
 * ...
 * 18 export function App() {
 * ...
 * 21     <section id="root-section">
 * 22       <Badge label={`n=${n}`} />
 * ```
 */
const VITE_MAP = JSON.stringify({
  version: 3,
  sources: ['probe.jsx'],
  mappings:
    'AAIS;AAHT,SAAS,gBAAgB;AAElB,gBAAS,MAAM,EAAE,MAAM,GAAG;AAC/B,SAAO,uBAAC,UAAK,WAAU,SAAS,mBAAzB;AAAA;AAAA;AAAA;AAAA,SAA+B;AACxC;AAEO,gBAAS,KAAK,EAAE,MAAM,GAAG;AAC9B,SACE,uBAAC,QAAG,WAAU,QACX,gBAAM,IAAI,CAAC,SACV,uBAAC,QAAe,kBAAP,MAAT;AAAA;AAAA;AAAA;AAAA,SAAqB,CACtB,KAHH;AAAA;AAAA;AAAA;AAAA,SAIA;AAEJ;AAEO,gBAAS,MAAM;AACpB,QAAM,CAAC,CAAC,IAAI,SAAS,CAAC;AACtB,SACE,uBAAC,aAAQ,IAAG,gBACV;AAAA,2BAAC,SAAM,OAAO,KAAK,CAAC,MAApB;AAAA;AAAA;AAAA;AAAA,WAAwB;AAAA,IACxB,uBAAC,QAAK,OAAO,CAAC,KAAK,GAAG,KAAtB;AAAA;AAAA;AAAA;AAAA,WAAyB;AAAA,OAF3B;AAAA;AAAA;AAAA;AAAA,SAGA;AAEJ;',
  names: [],
});

describe('a real dev-server map resolves a real browser frame', () => {
  const map = parseSourceMap(VITE_MAP);

  /**
   * Positions taken from `_debugStack` in Chromium, against that dev server.
   *
   * Each is the frame *below* React's own — the one that called `jsxDEV` — and
   * the expectation is where the element is written in the file a reviewer
   * opens. Nothing in the served module's line numbering matches the source's,
   * which is the entire reason the map hop exists: `<span>` is written on line 5
   * and the browser reports line 4.
   */
  it.each([
    ['<section>', 23, 26, 21, 5],
    ['<Badge>', 24, 21, 22, 7],
    ['<span>', 4, 26, 5, 10],
  ])('%s at generated %i:%i is source %i:%i', (_element, line, column, sourceLine, sourceColumn) => {
    expect(originalPositionFor(map, line, column)).toEqual({
      source: 'probe.jsx',
      line: sourceLine,
      column: sourceColumn,
    });
  });

  it('reads the sources the map declares', () => {
    expect(map).toHaveLength(1);
    expect(map[0]!.sources).toEqual(['probe.jsx']);
  });

  it('has nothing to say about a line past the end of the module', () => {
    expect(originalPositionFor(map, 9999, 1)).toBeNull();
  });
});

describe('decoding', () => {
  /** One segment, all deltas zero: generated 1:1 comes from source 1:1. */
  const identity = JSON.stringify({
    version: 3,
    sources: ['a.ts'],
    mappings: 'AAAA',
  });

  it('resolves the first mapping on a line', () => {
    expect(originalPositionFor(parseSourceMap(identity), 1, 1)).toEqual({
      source: 'a.ts',
      line: 1,
      column: 1,
    });
  });

  it('resolves a column between two mappings to the earlier one', () => {
    // Two segments on generated line 1: column 0 → 1:0, column 5 → 2:0.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA,KACA' }),
    );

    expect(originalPositionFor(map, 1, 4)?.line).toBe(1);
    expect(originalPositionFor(map, 1, 6)?.line).toBe(2);
  });

  it('resolves a column before the first mapping to the first construct on the line', () => {
    // The single segment starts at generated column 5; column 1 is the indent.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'KAAA' }),
    );

    expect(originalPositionFor(map, 1, 1)).toEqual({ source: 'a.ts', line: 1, column: 1 });
  });

  it('carries deltas across lines and segments', () => {
    // `;` advances the generated line and resets the generated column, while
    // source line and column keep accumulating — the property that makes a
    // mistake here silent rather than loud.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA;AACA;AACA' }),
    );

    expect(originalPositionFor(map, 3, 1)).toEqual({ source: 'a.ts', line: 3, column: 1 });
  });

  it('reads a negative delta', () => {
    // Second line maps back *up* to source line 1.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AACA;AADA' }),
    );

    expect(originalPositionFor(map, 1, 1)?.line).toBe(2);
    expect(originalPositionFor(map, 2, 1)?.line).toBe(1);
  });

  it('skips a segment that maps nowhere rather than borrowing the last source', () => {
    // `C` alone is a generated-column-only segment: a bundler's own prelude.
    // Resolving *at* it must not answer with the previous segment's origin.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA;C' }),
    );

    expect(originalPositionFor(map, 2, 1)).toBeNull();
  });

  it('resolves sources against sourceRoot', () => {
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sourceRoot: '/src/', sources: ['a.ts'], mappings: 'AAAA' }),
    );

    expect(originalPositionFor(map, 1, 1)?.source).toBe('/src/a.ts');
  });

  it('resolves a section of an index map at its offset', () => {
    const inner = { version: 3, sources: ['b.ts'], mappings: 'AAAA' };
    const map = parseSourceMap(
      JSON.stringify({
        version: 3,
        sections: [
          { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: 'AAAA' } },
          { offset: { line: 10, column: 0 }, map: inner },
        ],
      }),
    );

    expect(originalPositionFor(map, 1, 1)?.source).toBe('a.ts');
    expect(originalPositionFor(map, 11, 1)).toEqual({ source: 'b.ts', line: 1, column: 1 });
  });
});

describe('what it refuses', () => {
  it.each([
    ['not JSON at all', '<!doctype html><title>404</title>'],
    ['a version it does not know', JSON.stringify({ version: 4, sources: [], mappings: '' })],
    ['no mappings', JSON.stringify({ version: 3, sources: ['a.ts'] })],
    ['no sources', JSON.stringify({ version: 3, mappings: 'AAAA' })],
    ['a JSON scalar', '42'],
  ])('%s yields no map rather than a wrong one', (_case, text) => {
    expect(parseSourceMap(text)).toEqual([]);
  });

  it('drops a segment whose source index is out of range', () => {
    // `AEAA` is source index 0 + 2 against a map declaring one source: a
    // truncated `sources`, or a map paired with the wrong module.
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AEAA' }),
    );

    expect(originalPositionFor(map, 1, 1)).toBeNull();
  });
});

describe('finding the map a module points at', () => {
  it('reads the annotation at the end of a module', () => {
    expect(sourceMappingUrlOf('const a = 1;\n//# sourceMappingURL=out.js.map')).toBe('out.js.map');
  });

  it('accepts the block-comment form a CSS-adjacent build writes', () => {
    expect(sourceMappingUrlOf('a{}\n/*# sourceMappingURL=a.css.map */')).toBe('a.css.map');
  });

  it('takes the last annotation, not a mention of one in the code', () => {
    const code = ['const token = "sourceMappingURL=decoy.map";', '//# sourceMappingURL=real.map'].join(
      '\n',
    );

    expect(sourceMappingUrlOf(code)).toBe('real.map');
  });

  it('says nothing when a module carries no map', () => {
    expect(sourceMappingUrlOf('export const a = 1;\n')).toBeNull();
  });

  it('decodes an inline base64 map', () => {
    const json = JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA' });
    const url = `data:application/json;base64,${Buffer.from(json, 'utf8').toString('base64')}`;

    expect(inlineSourceMapOf(url)).toBe(json);
  });

  it('decodes an inline percent-encoded map', () => {
    const json = '{"version":3}';
    expect(inlineSourceMapOf(`data:application/json,${encodeURIComponent(json)}`)).toBe(json);
  });

  it('says nothing about a URL that is not a data map', () => {
    expect(inlineSourceMapOf('./out.js.map')).toBeNull();
  });
});
