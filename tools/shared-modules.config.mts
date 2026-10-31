import { execFileSync } from 'node:child_process';
import { isolator } from '@variance-authority/isolator/vite';
import picomatch from 'picomatch';
import { slice } from '../vitest.config.mjs';

/**
 * The unit slice with each worker keeping its modules across files, and the
 * isolator, not a fresh module graph, giving every file the values they loaded
 * with: `yarn test:shared`.
 *
 * It is the isolator README's Vitest setup run over this repository, so the
 * claim that it holds for a real suite is checked rather than argued. The
 * recorded run stays `isolate: true`: a worker that keeps a module credits it
 * to the first file that loaded it, and the record would say the files after
 * never entered it.
 *
 * A file that mocks or renders into a DOM runs in the `isolated` project. A
 * `vi.mock` reaches only the modules loaded after it, and React binds the DOM
 * and the DevTools hook it finds when it loads; the files are found by what
 * they declare, so a new one joins without a list to keep.
 */

const ROOT = import.meta.dirname.replace(/[/\\]tools$/, '');
const config = slice('unit');
const unit = picomatch(config.test.include, { ignore: config.test.exclude, dot: true });
const declaring = (pattern: string) =>
  execFileSync('git', ['grep', '-l', '-E', pattern], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((file) => file && unit(file));
const isolated = [...new Set([...declaring('@vitest-environment jsdom'), ...declaring('vi\\.(doM|m)ock\\(')])];

// ioc and the isolator are the reset itself, and `tools/` is the suite's own setup.
config.plugins = [...(config.plugins ?? []), isolator({ exclude: ['packages/ioc/**', 'packages/isolator/**', 'tools/**'] })];
config.test.setupFiles = ['tools/modules-per-file.ts', ...config.test.setupFiles];
config.test.projects = [
  // `extends` adds a project's include and exclude to the slice's, so each project only excludes.
  { extends: true, test: { name: 'shared', isolate: false, exclude: isolated } },
  {
    extends: true,
    test: {
      name: 'isolated',
      exclude: execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\n')
        .filter((file) => file && unit(file) && !isolated.includes(file)),
    },
  },
];

export default config;
