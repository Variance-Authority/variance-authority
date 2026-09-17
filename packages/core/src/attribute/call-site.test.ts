import { describe, expect, it } from 'vitest';
import type { Provenance, StackFrame } from '../format/provenance.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { createCallSiteResolver, locateProvenance, locateSites } from './call-site.js';

/**
 * The dev server, standing still.
 *
 * The map is the one Vite served for the probe component (see
 * `source-map.test.ts`), inlined the way Vite inlines it, so what is exercised
 * here is the whole hop: fetch the module, find the annotation, decode the data
 * URI, decode the mappings, resolve the frame, turn the map's relative source
 * into a path a report can hold.
 */
const VITE_MAP = {
  version: 3,
  sources: ['probe.jsx'],
  mappings:
    'AAIS;AAHT,SAAS,gBAAgB;AAElB,gBAAS,MAAM,EAAE,MAAM,GAAG;AAC/B,SAAO,uBAAC,UAAK,WAAU,SAAS,mBAAzB;AAAA;AAAA;AAAA;AAAA,SAA+B;AACxC;AAEO,gBAAS,KAAK,EAAE,MAAM,GAAG;AAC9B,SACE,uBAAC,QAAG,WAAU,QACX,gBAAM,IAAI,CAAC,SACV,uBAAC,QAAe,kBAAP,MAAT;AAAA;AAAA;AAAA;AAAA,SAAqB,CACtB,KAHH;AAAA;AAAA;AAAA;AAAA,SAIA;AAEJ;AAEO,gBAAS,MAAM;AACpB,QAAM,CAAC,CAAC,IAAI,SAAS,CAAC;AACtB,SACE,uBAAC,aAAQ,IAAG,gBACV;AAAA,2BAAC,SAAM,OAAO,KAAK,CAAC,MAApB;AAAA;AAAA;AAAA;AAAA,WAAwB;AAAA,IACxB,uBAAC,QAAK,OAAO,CAAC,KAAK,GAAG,KAAtB;AAAA;AAAA;AAAA;AAAA,WAAyB;AAAA,OAF3B;AAAA;AAAA;AAAA;AAAA,SAGA;AAEJ;',
  names: [],
};

const PROBE_URL = 'http://localhost:5199/src/probe.jsx';

/**
 * The annotation, assembled rather than written.
 *
 * Vite scans this very file for the token while transforming it, and a fixture
 * spelled out here is read as *this module's* map — it fails to load and prints
 * a stack. The same trap `sourceMappingUrlOf` documents, sprung on the test that
 * exercises it.
 */
const ANNOTATION = `//# source${'MappingURL'}=`;

function annotated(code: string, map: string): string {
  return `${code}\n${ANNOTATION}${map}`;
}

function inlined(map: unknown): string {
  const base64 = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
  return annotated('export function Badge() {}', `data:application/json;base64,${base64}`);
}

/** A fetcher over a fixed set of modules, counting what it was asked for. */
function server(modules: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (url: string) => {
      asked.push(url);
      return modules[url] ?? null;
    },
  };
}

const frame = (over: Partial<StackFrame> = {}): StackFrame => ({
  url: PROBE_URL,
  line: 23,
  column: 26,
  function: 'App',
  ...over,
});

describe('spending a frame on a source map', () => {
  it('turns the served position into the line somebody wrote', async () => {
    const dev = server({ [PROBE_URL]: inlined(VITE_MAP) });
    const resolver = createCallSiteResolver(dev.fetch);

    // Generated 23:26 in the module Vite served; `<section>` is on line 21 of
    // the file. Neither number is guessable from the other.
    expect(await resolver.locate([frame()])).toEqual({
      file: 'src/probe.jsx',
      line: 21,
      column: 5,
    });
  });

  it('drops the origin, because a port is a fact about one machine', async () => {
    // The map says `probe.jsx`, relative to the module. Resolved against the
    // module URL that is `/src/probe.jsx`, and what survives into a baseline must
    // not be `http://localhost:5199/…` — the next run picks a different port.
    const dev = server({ [PROBE_URL]: inlined(VITE_MAP) });
    const resolver = createCallSiteResolver(dev.fetch);

    expect((await resolver.locate([frame()]))?.file).toBe('src/probe.jsx');
  });

  it('fetches a module once for however many nodes came from it', async () => {
    const dev = server({ [PROBE_URL]: inlined(VITE_MAP) });
    const resolver = createCallSiteResolver(dev.fetch);

    // The measured shape of a real page: thousands of nodes, a handful of call
    // sites, one module. A hundred-row table writes two thousand cells from one
    // line of JSX, and this is the cache that makes that cost one fetch.
    await Promise.all([
      resolver.locate([frame()]),
      resolver.locate([frame()]),
      resolver.locate([frame({ line: 24, column: 21 })]),
      resolver.locate([frame({ line: 4, column: 26 })]),
    ]);

    expect(dev.asked).toEqual([PROBE_URL]);
    expect(resolver.stats).toEqual({ modules: 1, sites: 3, located: 4 });
  });

  it('resolves distinct call sites in one module to distinct lines', async () => {
    const dev = server({ [PROBE_URL]: inlined(VITE_MAP) });
    const resolver = createCallSiteResolver(dev.fetch);

    const section = await resolver.locate([frame()]);
    const badge = await resolver.locate([frame({ line: 24, column: 21 })]);
    const span = await resolver.locate([frame({ line: 4, column: 26 })]);

    expect([section?.line, badge?.line, span?.line]).toEqual([21, 22, 5]);
  });
});

describe('what it fetches, and what it will not', () => {
  it('follows a sibling .map, resolved against the module', async () => {
    // What a production bundler writes. `out.js.map` beside a module served from
    // `/assets/` is `/assets/out.js.map`, not `/out.js.map`.
    const dev = server({
      'http://host/assets/out.js': annotated('x', 'out.js.map'),
      'http://host/assets/out.js.map': JSON.stringify({
        version: 3,
        sources: ['../src/App.tsx'],
        mappings: 'AAAA',
      }),
    });
    const resolver = createCallSiteResolver(dev.fetch);

    expect(await resolver.locate([frame({ url: 'http://host/assets/out.js', line: 1, column: 1 })]))
      .toEqual({ file: 'src/App.tsx', line: 1, column: 1 });
    expect(dev.asked).toEqual([
      'http://host/assets/out.js',
      'http://host/assets/out.js.map',
    ]);
  });

  it('never asks for a dependency, saving a fetch of a megabyte of runtime', async () => {
    const dev = server({});
    const resolver = createCallSiteResolver(dev.fetch);

    const vendor = frame({ url: 'http://host/node_modules/react/jsx-runtime.js' });
    expect(await resolver.locate([vendor])).toBeNull();
    expect(dev.asked).toEqual([]);
  });

  it('skips a frame that maps into a dependency and tries the next', async () => {
    // A bundle served from the project's own path with a JSX runtime compiled
    // into it. The URL cannot tell; the mapped source can.
    const dev = server({
      'http://host/src/chunk.js': inlined({
        version: 3,
        sources: ['../node_modules/@emotion/react/jsx-runtime.js'],
        mappings: 'AAAA',
      }),
      'http://host/src/bundle.js': inlined({
        version: 3,
        sources: ['App.tsx'],
        mappings: 'AAAA',
      }),
    });
    const resolver = createCallSiteResolver(dev.fetch);

    const located = await resolver.locate([
      frame({ url: 'http://host/src/chunk.js', line: 1, column: 1 }),
      frame({ url: 'http://host/src/bundle.js', line: 1, column: 1 }),
    ]);

    // The first frame maps into a dependency and is spent; the second maps into
    // the project and is the answer.
    expect(located).toEqual({ file: 'src/App.tsx', line: 1, column: 1 });
  });

  it('keeps an unmapped filesystem module, which is what a Node runner reports', async () => {
    // Node applies source maps to `Error.stack` itself, so a Vitest or Jest frame
    // arrives already original. Fetching finds nothing and nothing is needed.
    const dev = server({});
    const resolver = createCallSiteResolver(dev.fetch);

    expect(await resolver.locate([frame({ url: '/app/src/probe.tsx', line: 5, column: 10 })]))
      .toEqual({ file: '/app/src/probe.tsx', line: 5, column: 10 });
  });

  it('says nothing when there are no frames to spend', async () => {
    const resolver = createCallSiteResolver(async () => null);
    expect(await resolver.locate([])).toBeNull();
  });
});

describe('spending the frames a node carried', () => {
  const resolver = createCallSiteResolver(async (url) =>
    url === PROBE_URL ? inlined(VITE_MAP) : null,
  );

  const provenance = (over: Partial<Provenance> = {}): Provenance => ({ owners: [], ...over });

  it('replaces the frames with the location they bought', async () => {
    const located = await locateProvenance(provenance({ stack: [frame()] }), resolver);

    expect(located.source).toEqual({ file: 'src/probe.jsx', line: 21, column: 5 });
    expect(located.stack).toBeUndefined();
  });

  it('drops the frames even when they bought nothing', async () => {
    // A frame is not a location and must never be mistaken for one downstream.
    // Unresolved means no source, not a URL with a port in it.
    const vendor = frame({ url: 'http://host/node_modules/react/index.js' });
    const located = await locateProvenance(provenance({ stack: [vendor] }), resolver);

    expect(located.source).toBeUndefined();
    expect(located.stack).toBeUndefined();
  });

  it('leaves provenance untouched when a runtime already recorded the location', async () => {
    const recorded = provenance({ source: { file: 'src/ds.jsx', line: 53, column: 5 } });

    expect(await locateProvenance(recorded, resolver)).toBe(recorded);
  });

  it('survives a fetch that throws rather than taking the run down', async () => {
    const angry = createCallSiteResolver(async () => {
      throw new Error('ECONNREFUSED');
    });
    const located = await locateProvenance(provenance({ stack: [frame()] }), angry);

    expect(located.source).toBeUndefined();
    expect(located.stack).toBeUndefined();
  });
});

/**
 * The demand side: a handful of nodes, asked about because a report is about to
 * name them.
 *
 * Every test here is really about *what was not fetched*. A page carries frames
 * on every node because reading one off a fiber is nearly free; turning one into
 * a file is a network round trip, and the run that pays for a tree's worth of
 * them to print three lines has bought nothing.
 */
describe('spending frames for the nodes a report names', () => {
  function node(path: string, provenance?: Provenance, children: SemanticNode[] = []): SemanticNode {
    return {
      path,
      tag: 'div',
      attributes: {},
      style: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
      children,
      ...(provenance !== undefined ? { provenance } : {}),
    };
  }

  function snapshotOf(root: SemanticNode): SemanticSnapshot {
    return {
      formatVersion: 1,
      subject: { id: 'fixture', kind: 'fixture' },
      profile: { id: 'chromium', layout: true, computedStyle: true, paint: false, bands: [] } as never,
      environment: { digest: 'v1:x', semanticDigest: 'v1:x', inputs: {} as never },
      renderHash: 'v1:x',
      structureHash: 'v1:x',
      styleHash: 'v1:x',
      root,
      styleProvenance: [],
      diagnostics: [],
    };
  }

  const TREE = snapshotOf(
    node('0', { owners: [], stack: [frame({ line: 4, column: 26 })] }, [
      node('0/0', { owners: [], stack: [frame()] }),
      node('0/1', { owners: [] }),
    ]),
  );

  function dev() {
    const serving = server({ [PROBE_URL]: inlined(VITE_MAP) });
    return { asked: serving.asked, resolver: createCallSiteResolver(serving.fetch) };
  }

  it('fills the location of the node it was asked about', async () => {
    const { resolver } = dev();
    const [region] = await locateSites([{ path: '0/0' }], TREE, resolver);

    expect(region?.source).toEqual({ file: 'src/probe.jsx', line: 21, column: 5 });
  });

  it('fetches nothing when nothing was asked about', async () => {
    // The green-suite case, and the reason any of this is deferred. Every
    // subject settled on its document digest, so there is no region and no
    // finding — and a resolver that fetched anyway would be spending the whole
    // run's savings on a report with no lines in it.
    const { asked, resolver } = dev();

    expect(await locateSites([], TREE, resolver)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('leaves a site that already knows its line alone', async () => {
    // React ≤18 and `jsx-source` both record the location outright, and
    // attribution has already copied it onto the region. Nothing to resolve.
    const { asked, resolver } = dev();
    const recorded = { path: '0/0', source: { file: 'src/App.jsx', line: 12, column: 3 } };

    expect(await locateSites([recorded], TREE, resolver)).toEqual([recorded]);
    expect(asked).toEqual([]);
  });

  it('ignores a site that names no node', async () => {
    // An unattributed region: no box contained it, so there is nothing to look
    // up and the walk of the tree must not happen either.
    const { asked, resolver } = dev();
    const sites = [{ cause: 'layout' }];

    // Returned by identity: nothing was resolved, so the caller's own array is
    // still the right answer and a copy would only make it look otherwise.
    expect(await locateSites(sites, TREE, resolver)).toBe(sites);
    expect(asked).toEqual([]);
  });

  it('says nothing for a node that carried no frames', async () => {
    const { asked, resolver } = dev();
    const [site] = await locateSites([{ path: '0/1' }], TREE, resolver);

    expect(site?.source).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('resolves two sites in one module with one fetch', async () => {
    // The two nodes come from different lines of the same file. What makes a
    // heavily-changed subject affordable is that the second costs no fetch.
    const { asked, resolver } = dev();
    const located = await locateSites([{ path: '0' }, { path: '0/0' }], TREE, resolver);

    expect(located.map((site) => site.source?.line)).toEqual([5, 21]);
    expect(asked).toEqual([PROBE_URL]);
  });

  it('keeps everything else a site was carrying', async () => {
    // A region is a rectangle, a cause and a component name before it is ever a
    // file. Resolution adds one field and owns none of the others.
    const { resolver } = dev();
    const region = { path: '0/0', component: 'Badge', pixels: 4821 };
    const [located] = await locateSites([region], TREE, resolver);

    expect(located).toEqual({ ...region, source: { file: 'src/probe.jsx', line: 21, column: 5 } });
  });
});
