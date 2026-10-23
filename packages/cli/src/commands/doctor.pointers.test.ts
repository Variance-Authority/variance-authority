import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import type { Config } from '../config.js';
import { parseArgs } from '../parse.js';
import { baselineFinding, doctor, machineProbes, type DoctorProbes } from './doctor.js';
import { exitForBaselines, exitForDiagnosis, formatBaselines, formatDiagnosis } from './doctor-report.js';

/**
 * An LFS store checked out without git-lfs, seen before the run meets it.
 *
 * The run refuses a pointer one subject at a time, and only the subjects whose
 * document moved ever look a baseline up — so a clone that skipped the smudge is
 * green until somebody edits a component. Doctor opens the first bytes of every
 * image the store reads, which is the one question the run never asks of the
 * subjects it settles without a lookup.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** A pointer as git-lfs writes one, per the v1 pointer spec. */
const POINTER =
  'version https://git-lfs.github.com/spec/v1\n' +
  'oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n' +
  'size 12345\n';

function lfsConfig(): Config {
  return {
    project: 'test',
    profile: 'chromium',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    retention: 'durable',
    subjects: { kind: 'list', ids: ['fixture:a'], collector: '/repo/collector.mjs' },
    baselines: { kind: 'lfs', root: '/repo/baselines' },
    fonts: [],
    report: '/repo/out/report.json',
    images: '/repo/out/images',
  } as Config;
}

function probesHolding(pointers: readonly string[]): DoctorProbes {
  return {
    async renderer(): Promise<Renderer> {
      return {
        identity: IDENTITY,
        async render(): Promise<Raster> {
          return {
            documentDigest: 'sha256-probe' as Raster['documentDigest'],
            identity: IDENTITY,
            width: 200,
            height: 40,
            bytes: '',
            missingFonts: [],
          };
        },
        async close() {
          /* nothing to release */
        },
      };
    },
    exists: async () => true,
    pointers: async () => pointers,
    partitions: async () => [{ identity: 'sha256-whatever', baselines: pointers.length }],
    renderCache: async () => ({ root: '/cache/renders', bytes: 0, entries: 0, identities: [] }),
    cache: async () => ({ root: '/cache', held: 0, remove: [], kept: [] }),
  };
}

describe('an LFS store of pointers', () => {
  const unsmudged = () => doctor(lfsConfig(), probesHolding(['button/primary.png', 'card/plain.png']));

  it('is named as pointers, with the file and the command that fetches the images', async () => {
    const { baselines } = await unsmudged();

    expect(baselines.pointers).toEqual(['button/primary.png', 'card/plain.png']);
    expect(baselines.because).toContain('2 of the images under /repo/baselines are git-LFS pointers');
    expect(baselines.because).toContain('button/primary.png');
    expect(baselines.because).toContain('git lfs install && git lfs pull');
  });

  it('is not reported as painted here, which a `readdir` of pointers would say', async () => {
    expect((await unsmudged()).baselines.paintedHere).toBeUndefined();
  });

  it('exits 2, the code the run gives the first subject it compares', async () => {
    expect(exitForDiagnosis(await unsmudged())).toBe(EXIT_OPERATOR);
  });

  it('heads its section so it is not read as a store that is fine', async () => {
    expect(formatDiagnosis(await unsmudged())).toContain('baselines: lfs — POINTERS, NOT IMAGES');
  });

  it('is not looked for in a directory store, which never had a smudge to skip', async () => {
    const probes = probesHolding([]);
    const asked: string[] = [];
    const config = { ...lfsConfig(), baselines: { kind: 'directory', root: '/repo/baselines' } } as Config;
    await doctor(config, {
      ...probes,
      pointers: async (root) => {
        asked.push(root);
        return [];
      },
    });
    expect(asked).toEqual([]);
  });
});

describe('an LFS store of pointers, with no renderer opened', () => {
  const noRenderer = (pointers: readonly string[]): DoctorProbes => ({
    ...probesHolding(pointers),
    renderer: () => {
      throw new Error('the store question opens no renderer');
    },
  });

  it('exits 2 under a remote renderer, which doctor never contacts', async () => {
    // The renderer is not checked, which exits 0 on its own; the store is read
    // from this disk either way, and its pointers stop the run all the same.
    const config = { ...lfsConfig(), renderer: { endpoint: 'http://pinned-runner:7777' } } as Config;
    const diagnosis = await doctor(config, noRenderer(['card/plain.png']));

    expect(diagnosis.renderer.checked).toBe(false);
    expect(exitForDiagnosis(diagnosis)).toBe(EXIT_OPERATOR);
  });

  it('is asked by `doctor --baselines`', () => {
    expect(parseArgs(['doctor', '--baselines'])).toEqual({
      command: 'doctor',
      config: resolve('variance.config.json'),
      baselines: true,
    });
  });

  it('is what `doctor --baselines` answers: the section and exit 2, without a browser', async () => {
    const finding = await baselineFinding(lfsConfig(), noRenderer(['card/plain.png']));

    expect(finding.pointers).toEqual(['card/plain.png']);
    expect(exitForBaselines(finding)).toBe(EXIT_OPERATOR);
    expect(formatBaselines(finding)).toContain('baselines: lfs — POINTERS, NOT IMAGES');
  });

  it('lets `doctor --baselines` pass a store of images, whoever painted them', async () => {
    const finding = await baselineFinding(lfsConfig(), noRenderer([]));

    expect(finding.pointers).toBeUndefined();
    expect(exitForBaselines(finding)).toBe(EXIT_CLEAN);
  });
});

describe('machineProbes pointers', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function rootWith(files: Readonly<Record<string, string | Buffer>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-doctor-pointers-'));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
      await mkdir(join(root, dirname(file)), { recursive: true });
      await writeFile(join(root, file), content);
    }
    return root;
  }

  /** A record the default `baselines.path` places, `{title}/{name}-{engine}`. */
  const RECORD = JSON.stringify({ subject: 'story:button--primary', identity: IDENTITY });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('reads the image beside each record the template places, by its first bytes', async () => {
    const root = await rootWith({
      'Button/Primary-chromium.json': RECORD,
      'Button/Primary-chromium.png': POINTER,
      'Card/Plain-chromium.json': RECORD,
      'Card/Plain-chromium.png': PNG,
    });

    expect(await machineProbes(lfsConfig()).pointers(root)).toEqual(['Button/Primary-chromium.png']);
  });

  it('reads every image in an identity directory, the layout before `baselines.path`', async () => {
    const root = await rootWith({
      'v1-9281721578cd1ed2bb1a8e23820a31a2/story%3Abutton--primary.png': POINTER,
      'v1-9281721578cd1ed2bb1a8e23820a31a2/story%3Acard--plain.png': PNG,
    });

    expect(await machineProbes(lfsConfig()).pointers(root)).toEqual([
      'v1-9281721578cd1ed2bb1a8e23820a31a2/story%3Abutton--primary.png',
    ]);
  });

  it('never names an LFS file the store does not read, so a collocated root of `.` is not the repository', async () => {
    const root = await rootWith({ 'docs/diagram.png': POINTER, 'stray.png': POINTER });

    expect(await machineProbes(lfsConfig()).pointers(root)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('passes over a file it cannot read, and still names the pointer beside it', async () => {
    // A file doctor cannot open is not one the run will refuse as a pointer, and
    // one unreadable file must not cost the operator the answer for the rest.
    const root = await rootWith({
      'Button/Locked-chromium.json': RECORD,
      'Button/Locked-chromium.png': 'not a pointer',
      'Button/Primary-chromium.json': RECORD,
      'Button/Primary-chromium.png': POINTER,
    });
    await chmod(join(root, 'Button/Locked-chromium.png'), 0o000);

    expect(await machineProbes(lfsConfig()).pointers(root)).toEqual(['Button/Primary-chromium.png']);
  });

  it.skipIf(spawnSync('git', ['lfs', 'version']).status !== 0)(
    'answers none in a work tree where git runs git-lfs, since the run fetches each image it compares',
    async () => {
      const root = await rootWith({
        'Button/Primary-chromium.json': RECORD,
        'Button/Primary-chromium.png': POINTER,
      });
      for (const args of [['init', '-q'], ['lfs', 'install', '--local', '--skip-smudge']]) {
        expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
      }

      expect(await machineProbes(lfsConfig()).pointers(root)).toEqual([]);
    },
  );

  it('answers none for a root that is not there', async () => {
    expect(await machineProbes(lfsConfig()).pointers(join(tmpdir(), 'variance-no-such-root'))).toEqual([]);
  });
});
