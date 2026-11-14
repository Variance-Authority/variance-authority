import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { expect, it } from 'vitest';

type Recorder = typeof import('./journey-recorder.cjs');
type ProbeLog = typeof import('../instrument/probe-log.cjs');

/**
 * A loader of built files, each run as an ES module bundle runs a CommonJS
 * file it packed: a sibling it packed is there, and a builtin is refused, as
 * esbuild's stand-in for `require` refuses one where an ES module has none.
 */
function packed(): (file: string) => unknown {
  const loaded = new Map<string, { exports: unknown }>();
  const load = (path: string): unknown => {
    const known = loaded.get(path);
    if (known !== undefined) return known.exports;
    const module = { exports: {} };
    loaded.set(path, module);
    const request = (asked: string): unknown => {
      if (!asked.startsWith('.')) throw new Error(`Dynamic require of "${asked}" is not supported`);
      return load(resolve(dirname(path), asked));
    };
    runInThisContext(`(function (module, exports, require) {${readFileSync(path, 'utf8')}\n})`)(module, module.exports, request);
    return module.exports;
  };
  return (file) => load(fileURLToPath(new URL(`../../dist/${file}`, import.meta.url)));
}

it('tells a story in an ES module bundle, which can require no builtin', () => {
  const load = packed();
  const { storyTap, storyFormat } = (load('test-selection/journey-recorder.cjs') as Recorder).loadRecorder();
  const tap = storyTap.createTap((load('instrument/probe-log.cjs') as ProbeLog).createEngine(true), storyTap.PART_LIMIT, true);

  expect(storyFormat.decodeStory(storyFormat.encodeStory(tap.take('j-1'), 'j-1')).notes).toEqual([]);
});
