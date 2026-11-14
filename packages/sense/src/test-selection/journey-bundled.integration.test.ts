import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('tells a story from a head a bundler packed, with no file of the package beside it', async () => {
  const out = await mkdtemp(join(tmpdir(), 'variance-bundled-head-'));
  temporary.push(out);
  // A service bundled for Node, every module of the package inside it.
  await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(new URL('../../dist/test-selection/journey-story.js', import.meta.url)),
      outDir: out,
      rollupOptions: { output: { format: 'esm', entryFileNames: 'head.mjs' } },
    },
  });
  const { tapeJourneys } = (await import(pathToFileURL(join(out, 'head.mjs')).href)) as typeof import('./journey-story.js');
  const probeLog = (await import('../../dist/instrument/probe-log.cjs')).default as typeof import('../instrument/probe-log.cjs');
  const storyFormat = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');

  const tape = tapeJourneys(probeLog.createEngine(true));

  expect(storyFormat.decodeStory(Buffer.from(tape.storyOf('j-1'), 'base64')).notes).toEqual([]);
});
