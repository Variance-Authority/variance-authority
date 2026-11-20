import { execFileSync } from 'node:child_process';
import { isolator } from '@variance-authority/isolator/vite';
import { withTestSelection } from '@variance-authority/sense/vitest';
import picomatch from 'picomatch';
import { selection, slice } from '../vitest.config.mjs';

/**
 * `yarn test:shared`: the isolator README's Vitest setup over the unit slice,
 * so the claim that it holds for a real suite is run rather than argued. ioc,
 * the isolator and `tools/` stay shared, being the reset and the setup. The
 * recorded run stays isolated: a kept module is credited only to the first
 * file that loaded it.
 *
 * A file that mocks, renders into a DOM or loads Playwright's test loader runs
 * isolated, found by what it declares: a `vi.mock` reaches only modules loaded
 * after it, React binds the DOM it finds as it loads, and Playwright's loader
 * hooks `require` and ESM for the process with no way back.
 *
 * Wrapped to select and record nothing: with `VARIANCE_AUTHORITY_SINCE` set,
 * even empty as CI sets it, it runs the files the unit slice's own run would
 * select from the same record, so a pull request's unit leg runs its selection
 * here too; unset, every file runs, as on `main`.
 */

const ROOT = import.meta.dirname.replace(/[/\\]tools$/, '');
const config = slice('unit');
const unit = picomatch(config.test.include, { ignore: config.test.exclude, dot: true });
// FIXME: a text match; a `vi.mock` in a helper a test imports leaves its file shared. Read sense's mock parse instead.
const declaring = (pattern: string) =>
  execFileSync('git', ['grep', '-l', '-E', pattern], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((file) => file && unit(file));
const isolated = [...new Set([...declaring('@vitest-environment jsdom'), ...declaring('vi\\.(doM|m)ock\\('), ...declaring("playwright/lib/common'")])];

// `tools/` is the suite's own setup. ioc and the isolator list themselves in `sideEffects`.
config.plugins = [...(config.plugins ?? []), isolator({ exclude: ['tools/**'] })];
config.test.setupFiles = ['tools/modules-per-file.ts', ...config.test.setupFiles];
// A module leak shows only in some file orders, so every run takes a new one
// and prints its seed. Tests keep their order inside a file, as in every slice.
config.test.sequence = { ...config.test.sequence, shuffle: { files: true, tests: false } };
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

export default withTestSelection(config, { ...selection, record: false });
