import { deflateSync } from 'node:zlib';
import type { SourceIndex } from '@variance-authority/core/attribute';
import {
  documentDigest,
  type Diagnostic,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core/format';
import type { Relations } from '@variance-authority/core/relate';
import {
  createEphemeralStore,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { ExecutionNarrowing } from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import type { JourneyReading } from './journeys.js';
import {
  run,
  type CliRunReport,
  type Collected,
  type Collector,
  type Plan,
  type PlannedSubject,
} from './run.js';

/**
 * Fixture builders for a run: a viewport, an identity, a document, a store that
 * answers, and a `run` with every dependency faked.
 *
 * Shared rather than test-local because `run.ts` was split into the files a
 * reader can hold in their head, and its tests were split the same way — so the
 * same fake renderer now has to serve four test files. A copy per file is how two
 * of them quietly stop agreeing on what a baseline looks like, and then a test
 * passes because its fake is wrong rather than because the code is right.
 *
 * The same argument `packages/core`'s `fixture.ts` makes, for the same reason:
 * these are hand-written data, and everything below is reachable with no browser,
 * no disk and no clock. That is a property of the design (the run takes its
 * clock, its writer and its renderer as injected fields), and these builders are
 * how it stays honest.
 */

export const VIEWPORT: Viewport = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  colorScheme: 'light',
};

export const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  // 1 here, as a real renderer reports it: the document's viewport supplies the
  // scale a raster is actually painted at. Exercising the gap on purpose.
  deviceScaleFactor: 1,
  fonts: [],
};

/**
 * A design system served from a cross-origin `<link>`, at the severity that gates.
 *
 * `error` is what `collector-dom` raises for this code, and it is restated here
 * rather than imported: the CLI's half of the contract is that `exitFor` reads the
 * severity and nothing else, and that half has to be pinned independently of which
 * severity any one collector chooses.
 */
export const UNREADABLE: Diagnostic = {
  severity: 'error',
  code: 'unreadable-stylesheet',
  message: 'stylesheet "https://cdn.example/tokens.css" is cross-origin; its rules were not collected',
};

export const DANGLING: Diagnostic = {
  severity: 'warn',
  code: 'dangling-id-reference',
  message: 'reference to id "label" resolves outside the subject subtree',
};

export function documentFor(id: string, html = '<div data-va-path="0">x</div>'): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

export function rasterFor(document: RenderDocument, identity: RenderIdentity): Raster {
  return {
    documentDigest: documentDigest(document),
    identity: { ...identity, deviceScaleFactor: document.viewport.deviceScaleFactor },
    width: 100,
    height: 40,
    bytes: Buffer.from('not a real png').toString('base64'),
    missingFonts: [],
  };
}

export function fakeRenderer(identity: RenderIdentity = IDENTITY): Renderer {
  return {
    identity,
    identityFor(document) {
      return { ...identity, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document) {
      return rasterFor(document, identity);
    },
    async close() {
      /* nothing to release */
    },
  };
}

/**
 * An ephemeral store — a real cache — with the baseline lookups answering
 * whatever a test needs.
 *
 * `describe` is derived from the same `found` rather than inherited from the
 * ephemeral base, because a store whose two lookups disagree is not a store. The
 * run reads the cheap one to settle and the expensive one only to write a diff
 * image, so a fake answering `null` to the first would send every test here down
 * the render path no matter what it set up — passing for the wrong reason, which
 * is the failure mode a fake is most likely to introduce.
 */
export function storeAnswering(found: Found | null | (() => never)): RasterStore {
  const base = createEphemeralStore();
  const answer = (): Found | null => {
    if (typeof found === 'function') found();
    return found as Found | null;
  };

  return {
    ...base,
    async find() {
      return answer();
    },
    async describe() {
      const baseline = answer();
      if (baseline === null) return null;
      return {
        documentDigest: baseline.raster.documentDigest,
        comparable: baseline.comparable,
        storedUnder: baseline.storedUnder,
        missingFonts: baseline.raster.missingFonts,
        ...(baseline.raster.accessibility === undefined
          ? {}
          : { accessibility: baseline.raster.accessibility }),
        // Names only, as a real backend reads them out of the sidecar. Absent
        // when the baseline records none, which is what `--since` reads as
        // *unknown* and therefore observes.
        ...(baseline.raster.components === undefined
          ? {}
          : { components: baseline.raster.components.map((hash) => hash.component) }),
      };
    },
  };
}

/**
 * A real PNG of one flat colour, because the comparison decodes what it is given
 * and a stub does not survive `PNG.sync.read`.
 *
 * Hand-rolled on `node:zlib` rather than on `pngjs`, which would be a fourth
 * package declaring the same requirement to write ten pixels.
 */
export function pngOf(level: number): string {
  const raw = Buffer.alloc(10 * (1 + 10 * 4));
  for (let y = 0; y < 10; y += 1) {
    const row = y * (1 + 10 * 4);
    raw[row] = 0;
    for (let x = 0; x < 10; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = level;
      raw[at + 1] = level;
      raw[at + 2] = level;
      raw[at + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10, 0);
  ihdr.writeUInt32BE(10, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

export const WHITE = pngOf(255);
export const BLACK = pngOf(0);

/**
 * A renderer that actually paints: black for a document marked `data-paint="dark"`,
 * white otherwise.
 *
 * Shared rather than test-local for the reason everything else here is. The two
 * second-pass suites — the clean world and the second reading — both need a real
 * image to reach a `changed` verdict, and two hand-rolled PNG writers is how they
 * would come to disagree about what a baseline looks like.
 */
export function painter(): Renderer {
  return {
    identity: IDENTITY,
    identityFor(document) {
      return { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document) {
      return {
        documentDigest: documentDigest(document),
        identity: { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor },
        width: 10,
        height: 10,
        bytes: document.html.includes('data-paint="dark"') ? BLACK : WHITE,
        missingFonts: [],
      };
    },
    async close() {
      /* nothing to release */
    },
  };
}

/** The baseline a `painter()` run compares against: this document, painted white. */
export function whiteBaselineOf(document: RenderDocument): Found {
  return {
    raster: {
      documentDigest: documentDigest(document),
      identity: { ...IDENTITY, deviceScaleFactor: VIEWPORT.deviceScaleFactor },
      width: 10,
      height: 10,
      bytes: WHITE,
      missingFonts: [],
    },
    comparable: true,
    storedUnder: IDENTITY,
  };
}

export function collectorOf(
  plan: Plan,
  collect: (subject: PlannedSubject) => Collected,
): Collector {
  return {
    async plan() {
      return plan;
    },
    async collect(subject) {
      return collect(subject);
    },
    async close() {
      /* nothing to release */
    },
  };
}

export function configOf(overrides: Partial<Config> = {}): Config {
  return {
    project: 'test',
    profile: 'chromium',
    viewport: VIEWPORT,
    retention: 'durable',
    subjects: { kind: 'list', ids: ['fixture:a'], collector: '/repo/collector.mjs' },
    baselines: { kind: 'directory', root: '/repo/baselines' },
    fonts: [],
    report: '/repo/out/report.json',
    images: '/repo/out/images',
    ...overrides,
  };
}

export interface Written {
  readonly artifacts: Map<string, Buffer>;
  reports: CliRunReport[];
}

export async function runWith(
  config: Config,
  collector: Collector,
  store: RasterStore,
  options: {
    subjects?: string;
    intent?: string;
    renderer?: Renderer;
    flakes?: boolean;
    since?: {
      readonly ref: string;
      readonly changed: readonly string[];
      readonly diff?: string;
    };
    scanSource?: (dirs: readonly string[]) => Promise<SourceIndex>;
    readJourney?: (diff: string, relations?: Relations) => Promise<ExecutionNarrowing | undefined>;
    readJourneys?: (subjects: readonly string[]) => Promise<JourneyReading>;
  } = {},
): Promise<{ report: CliRunReport; written: Written }> {
  const written: Written = { artifacts: new Map(), reports: [] };

  const report = await run({
    config,
    ...(options.subjects !== undefined ? { subjects: options.subjects } : {}),
    ...(options.intent !== undefined ? { intent: options.intent } : {}),
    ...(options.flakes === true ? { flakes: true } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
    deps: {
      ...(options.scanSource !== undefined ? { scanSource: options.scanSource } : {}),
      ...(options.readJourney !== undefined ? { readJourney: options.readJourney } : {}),
      ...(options.readJourneys !== undefined ? { readJourneys: options.readJourneys } : {}),
      collector,
      store,
      renderer: async () => options.renderer ?? fakeRenderer(),
      now: () => '2026-08-01T00:00:00.000Z',
      writeArtifact: async (path, bytes) => {
        written.artifacts.set(path, bytes);
      },
      writeReport: async (_path, value) => {
        written.reports.push(value);
      },
    },
  });

  return { report, written };
}
