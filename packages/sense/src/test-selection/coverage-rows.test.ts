import { describe, expect, it } from 'vitest';
import { instrument } from '../instrument/index.js';
import { coverageBlocks, recordedBlocks } from './coverage-rows.js';
import { recordedFrame, type TransformSourceMap } from './source-lines.js';

const FILE = '/checkout/src/price.ts';

const SOURCE = `export interface Order { readonly total?: number; readonly tier?: { readonly rate: number } }

export function price(order: Order | undefined): number {
  const total = order?.total ?? 0;
  if (total > 100) {
    return total * (order?.tier?.rate ?? 1);
  } else {
    return total;
  }
}

export class Cart {
  add(items: number[], value?: number): void {
    for (const item of [value]) items.push(item ?? 0);
  }
}
`;

// Two builds of SOURCE: swc's output and map at `es2015` and at `es2022`, verbatim.
const LOWERED = {
  code: 'export function price(order) {\n    var _ref;\n    const total = (_ref = order === null || order === void 0 ? void 0 : order.total) !== null && _ref !== void 0 ? _ref : 0;\n    if (total > 100) {\n        var _ref1;\n        var _order_tier;\n        return total * ((_ref1 = order === null || order === void 0 ? void 0 : (_order_tier = order.tier) === null || _order_tier === void 0 ? void 0 : _order_tier.rate) !== null && _ref1 !== void 0 ? _ref1 : 1);\n    } else {\n        return total;\n    }\n}\nexport class Cart {\n    add(items, value) {\n        for (const item of [\n            value\n        ])items.push(item !== null && item !== void 0 ? item : 0);\n    }\n}\n',
  map: {
    mappings:
      'AAEA,OAAO,SAASA,MAAMC,KAAwB;;IAC5C,MAAMC,gBAAQD,kBAAAA,4BAAAA,MAAOC,KAAK,uCAAI;IAC9B,IAAIA,QAAQ,KAAK;;YACCD;QAAhB,OAAOC,kBAASD,kBAAAA,6BAAAA,cAAAA,MAAOE,IAAI,cAAXF,kCAAAA,YAAaG,IAAI,yCAAI;IACvC,OAAO;QACL,OAAOF;IACT;AACF;AAEA,OAAO,MAAMG;IACXC,IAAIC,KAAe,EAAEC,KAAc,EAAQ;QACzC,KAAK,MAAMC,QAAQ;YAACD;SAAM,CAAED,MAAMG,IAAI,CAACD,iBAAAA,kBAAAA,OAAQ;IACjD;AACF',
    sources: [FILE],
  },
};
const MODERN = {
  code: 'export function price(order) {\n    const total = order?.total ?? 0;\n    if (total > 100) {\n        return total * (order?.tier?.rate ?? 1);\n    } else {\n        return total;\n    }\n}\nexport class Cart {\n    add(items, value) {\n        for (const item of [\n            value\n        ])items.push(item ?? 0);\n    }\n}\n',
  map: {
    mappings:
      'AAEA,OAAO,SAASA,MAAMC,KAAwB;IAC5C,MAAMC,QAAQD,OAAOC,SAAS;IAC9B,IAAIA,QAAQ,KAAK;QACf,OAAOA,QAASD,CAAAA,OAAOE,MAAMC,QAAQ,CAAA;IACvC,OAAO;QACL,OAAOF;IACT;AACF;AAEA,OAAO,MAAMG;IACXC,IAAIC,KAAe,EAAEC,KAAc,EAAQ;QACzC,KAAK,MAAMC,QAAQ;YAACD;SAAM,CAAED,MAAMG,IAAI,CAACD,QAAQ;IACjD;AACF',
    sources: [FILE],
  },
};

function rows(build: { code: string; map: TransformSourceMap }, source = SOURCE) {
  const frame = recordedFrame(build.code, build.map, FILE, () => source);
  return coverageBlocks(instrument(build.code, FILE)!.blocks, frame);
}

describe('coverageBlocks', () => {
  // A package's own tests load its source through one transform and every other
  // package's tests load its build through another. Both are filed under the
  // source, with one source digest and one set of lines; a region digest that
  // depended on the emitted text would read every region as edited the moment
  // the two met in one merge.
  it('digests a region from the source it maps to, whichever build was instrumented', () => {
    const identity = (row: ReturnType<typeof rows>[number]) => [row.name, row.path, row.startLine, row.endLine, row.digest];
    expect(rows(LOWERED).map(identity)).toEqual(rows(MODERN).map(identity));
  });

  // The lines inside a region a region owns are that region's, so an edit there
  // is charged to it and to nothing around it.
  it('charges an edit to the region whose own lines it lands on', () => {
    const edit = (text: string) => text.replace('rate ?? 1)', 'rate ?? 2)');
    const before = rows(MODERN);
    const after = rows({ code: edit(MODERN.code), map: MODERN.map }, edit(SOURCE));
    const changed = before
      .filter((row, index) => row.digest !== after[index]!.digest)
      .map((row) => `${row.name} ${row.path}`);
    expect(changed).toEqual(['price if#0/then']);
  });
});

describe('recordedBlocks', () => {
  // What a runner's own transform hands `instrumentModule` with its map, and
  // what a seam reads of a build through the map beside it.
  const built = (build: { code: string; map: TransformSourceMap }) => {
    const frame = recordedFrame(build.code, build.map, FILE, () => SOURCE);
    return recordedBlocks(instrument(build.code, FILE)!.blocks, frame, build.code, 'presence');
  };
  const own = coverageBlocks(instrument(SOURCE, FILE)!.blocks, recordedFrame(SOURCE, undefined, FILE, () => SOURCE));

  it('records a build that cut the regions its source cuts as the source', () => {
    expect(built(MODERN)).toEqual(own);
  });

  it('opens and closes the module of a build that cut regions its source has not where the source does', () => {
    // A helper a bundler wrote above the module, with no origin in its map.
    const rows = built({
      code: `var __name = (target, value) => target;\n${MODERN.code}`,
      map: { ...MODERN.map, mappings: `;${MODERN.map.mappings}` },
    });
    expect(rows.length).toBe(own.length + 1);
    expect(rows[0]).toMatchObject({ kind: 'module', startLine: own[0]!.startLine, endLine: own[0]!.endLine, digest: own[0]!.digest });
    expect(rows[1]).not.toHaveProperty('startLine');
    expect(rows[1]).not.toHaveProperty('endLine');
  });

  it('records the regions a build shares with its source at the source\'s lines when the build cut one more', () => {
    // tsc's shape: the call written over four lines is emitted on one, so the
    // map closes the `await` on the line it opened. A helper a bundler wrote
    // above the module keeps the two walks from numbering alike.
    const source = 'export async function f(a) {\n  await a.go(\n    1,\n  );\n}\n';
    const code = 'var __name = (target, value) => target;\nexport async function f(a) {\n  await a.go(1);\n}\n';
    const map = { mappings: ';AAAA;AACA;AAGA', sources: [FILE] };
    const frame = recordedFrame(code, map, FILE, () => source);
    const cut = coverageBlocks(instrument(source, FILE)!.blocks, recordedFrame(source, undefined, FILE, () => source));
    const shared = (row: { name: string; path: string }) => cut.some((own) => own.name === row.name && own.path === row.path);

    const rows = recordedBlocks(instrument(code, FILE)!.blocks, frame, code, 'presence');

    const extent = (row: (typeof cut)[number]) => [row.kind, row.name, row.path, row.startLine, row.endLine, row.digest];
    expect(rows.filter(shared).map(extent)).toEqual(cut.map(extent));
  });

  it('keeps a build region with no source of its own off the lines of the source region named like it', () => {
    // A region the build cut empty is not the region the source wrote under that
    // name: a span would charge it for lines it does not cover.
    const source = 'export async function f(a) {\n  await a.go(\n    1,\n  );\n}\n';
    const code = 'var __name = (target, value) => target;\nexport async function f(a) {\n  await a.go(1);\n}\n';
    const map = { mappings: ';AAAA;AACA;AAGA', sources: [FILE] };
    const frame = recordedFrame(code, map, FILE, () => source);
    const blocks = instrument(code, FILE)!.blocks;
    const at = blocks.findIndex((block) => block.kind === 'resume');
    const emptied = blocks.map((block, index) => (index === at ? { ...block, end: block.start } : block));

    const rows = recordedBlocks(emptied, frame, code, 'presence');

    expect(rows[at]).toMatchObject({ kind: 'resume', path: 'await#0', source: false });
    expect(rows[at]!.endLine).toBe(rows[at]!.startLine);
  });

  it('reads a build through its map when it moved regions its source names alike', () => {
    // The walk names both callbacks `f/on.arg1`; the build swapped their lines.
    const source = "export function f(a) {\n  a.on('x', () => 1);\n  a.on('x', () => 22);\n}\n";
    const lines = source.split('\n');
    const code = [lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n');
    const map = { mappings: 'AAAA;AAEA;AADA;AAEA', sources: [FILE] };
    const frame = recordedFrame(code, map, FILE, () => source);
    const blocks = instrument(code, FILE)!.blocks;
    const twentyTwo = blocks.findIndex((block) => block.name === 'f/on.arg1' && code.slice(block.start, block.end).includes('22'));

    const rows = recordedBlocks(blocks, frame, code, 'presence');

    expect(rows[twentyTwo]).toMatchObject({ name: 'f/on.arg1', startLine: 3, endLine: 3 });
  });

  it('reads a build through its map when the source it maps to does not parse', () => {
    // A source the walk refuses has no cut of its own to record a build at.
    const broken = `${SOURCE}export function (\n`;
    const frame = recordedFrame(MODERN.code, MODERN.map, FILE, () => broken);
    const blocks = instrument(MODERN.code, FILE)!.blocks;
    expect(recordedBlocks(blocks, frame, MODERN.code, 'presence')).toEqual(coverageBlocks(blocks, frame));
  });
});
