import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTestSelection } from './vitest.js';

describe('how the case runner reaches Vitest\'s runner', () => {
  it('names Vitest\'s own packages by a path the runner file can resolve', async () => {
    // `@vitest/runner` is Vitest's dependency, not the project's, and the case
    // runner is a file in the project root. Under a layout that does not hoist
    // — pnpm's — a bare specifier there resolves to nothing: measured on
    // TanStack Query, where 163 files failed to load, the 25 that needed no
    // runner passed, and the run reported itself green in a third of the time.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-runner-import-'));
    const vitest = resolve(root, 'node_modules/vitest');
    const runnerPackage = resolve(vitest, 'node_modules/@vitest/runner');
    try {
      await mkdir(runnerPackage, { recursive: true });
      await writeFile(resolve(root, 'package.json'), '{"name":"project"}');
      await writeFile(
        resolve(vitest, 'package.json'),
        '{"name":"vitest","main":"index.js","dependencies":{"@vitest/runner":"4.1.11"}}',
      );
      await writeFile(resolve(vitest, 'index.js'), 'export {};');
      await writeFile(resolve(runnerPackage, 'package.json'), '{"name":"@vitest/runner","main":"index.js"}');
      await writeFile(resolve(runnerPackage, 'index.js'), 'export const getFn = () => undefined;');
      await writeFile(resolve(runnerPackage, 'utils.js'), 'export const getNames = () => [];');

      // The layout this is about: reachable from Vitest, unreachable from the
      // project that installed it.
      expect(() => createRequire(resolve(root, 'package.json')).resolve('@vitest/runner')).toThrow();

      const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin') });
      const runner = configured.test!.runner as string;
      const source = await readFile(runner, 'utf8');
      const spelling = (name: string): string =>
        new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "([^"]+)"`).exec(source)![1]!;
      const from = createRequire(runner);

      // Relative, because a leading slash is root-relative to Vite — and to the
      // file Vitest loads, because a second copy of `@vitest/runner` is a
      // second `getFn` over a different map.
      expect(spelling('getFn')).toMatch(/^\.\./);
      const fromVitest = createRequire(resolve(vitest, 'package.json'));
      expect(from.resolve(spelling('getFn'))).toBe(fromVitest.resolve('@vitest/runner'));
      expect(from.resolve(spelling('getNames'))).toBe(fromVitest.resolve('@vitest/runner/utils'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names no package of Vitest\'s own where Vitest ships none, as Vitest 5 does', async () => {
    // Vitest 5 folded `@vitest/runner` into itself and dropped `vitest/runners`.
    // A runner that imports either fails every test file to load, and Vite
    // resolves an import it can see before it runs a line, so a fallback the
    // runner never reaches fails as well.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-runner-import-'));
    const vitest = resolve(root, 'node_modules/vitest');
    try {
      await mkdir(vitest, { recursive: true });
      await writeFile(resolve(root, 'package.json'), '{"name":"project"}');
      await writeFile(resolve(vitest, 'package.json'), '{"name":"vitest","exports":{".":"./index.js"}}');
      await writeFile(resolve(vitest, 'index.js'), 'export class TestRunner {}');

      const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin') });
      const source = await readFile(configured.test!.runner as string, 'utf8');

      expect(source).not.toContain('@vitest/runner');
      expect(source).not.toContain('vitest/runners');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('asks Vitest\'s manifest whether it ships a runner package, not whatever resolves from it', async () => {
    // A project on Vitest 5 inside a monorepo whose root runs an older Vitest:
    // `@vitest/runner` resolves from Vitest 5 by walking up to the root's copy,
    // which is another Vitest's runner. Measured on this repository's own
    // `cases/vitest-5-case`, where it failed every file to load.
    const outer = await mkdtemp(resolve(tmpdir(), 'variance-runner-import-'));
    const root = resolve(outer, 'project');
    const vitest = resolve(root, 'node_modules/vitest');
    const stray = resolve(outer, 'node_modules/@vitest/runner');
    try {
      await mkdir(vitest, { recursive: true });
      await mkdir(stray, { recursive: true });
      await writeFile(resolve(root, 'package.json'), '{"name":"project"}');
      await writeFile(resolve(vitest, 'package.json'), '{"name":"vitest","exports":{".":"./index.js"}}');
      await writeFile(resolve(vitest, 'index.js'), 'export class TestRunner {}');
      await writeFile(resolve(stray, 'package.json'), '{"name":"@vitest/runner","main":"index.js"}');
      await writeFile(resolve(stray, 'index.js'), 'export const getFn = () => undefined;');
      await writeFile(resolve(stray, 'utils.js'), 'export const getNames = () => [];');

      // The layout this is about: a runner package reachable from Vitest 5.
      expect(() => createRequire(resolve(vitest, 'package.json')).resolve('@vitest/runner')).not.toThrow();

      const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin') });
      const source = await readFile(configured.test!.runner as string, 'utf8');

      expect(source).not.toContain('@vitest/runner');
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });
});
