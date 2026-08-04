import {
  documentDigest,
  type Diagnostic,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import {
  createEphemeralStore,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { Config } from '../config.js';
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
 * `collector-dom` emits this code at `warn` today; `error` is used here because
 * the severity is what `exitFor` reads, and the CLI's half of that contract has to
 * be pinned independently of which severity any one collector chooses.
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
      };
    },
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
  options: { subjects?: string; intent?: string; renderer?: Renderer } = {},
): Promise<{ report: CliRunReport; written: Written }> {
  const written: Written = { artifacts: new Map(), reports: [] };

  const report = await run({
    config,
    ...(options.subjects !== undefined ? { subjects: options.subjects } : {}),
    ...(options.intent !== undefined ? { intent: options.intent } : {}),
    deps: {
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
