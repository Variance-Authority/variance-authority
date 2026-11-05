/**
 * The addon in a real Vite Storybook, built by `storybook build --test` as a
 * project runs it, with a `.storybook/preview.js` that holds a decorator.
 * Storybook's own Vite plugins rewrite the preview file, so this is the build
 * that shows whether its probes still sit where its regions are.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** The addon, by the path Storybook loads a preset from. */
const ADDON = resolve(import.meta.dirname, 'preset.ts');
const STORYBOOK = resolve(dirname(require.resolve('storybook/package.json')), 'dist/bin/dispatcher.js');
/** The story `storybook init` writes a JavaScript project, in the version installed. */
const INIT_STORY = resolve(dirname(require.resolve('@storybook/react/package.json')), 'template/cli/js/Page.stories.js');

const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * The decorator's regions sit below a comment and a blank line, so a step that
 * reprints the file moves them: line 11 holds the branch, line 12 the rest.
 * It mocks a module as Storybook 9.1 has a preview do it, with
 * `sb.mock(import(...))`, which Storybook rewrites to the path alone, so the
 * page never loads the module for it.
 */
const PREVIEW = `import { sb } from 'storybook/test';
import { Box } from '../src/box.jsx';

/**
 * Every story framed.
 */
export const decorators = [
  (Story, { parameters }) => {
    const framed = parameters.framed;

    if (framed) return Box({ children: Story() });
    return Story();
  },
];

sb.mock(import('../src/tone.js'));

export default { parameters: { layout: 'centered' } };
`;

/** A React Vite Storybook with one story and the preview above, in a fresh directory. */
async function storybook(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-authority-vite-storybook-')));
  temporary.push(root);
  await mkdir(resolve(root, '.storybook'), { recursive: true });
  await mkdir(resolve(root, 'src'), { recursive: true });
  // The project's own `node_modules`, where Storybook resolves its framework from `.storybook`.
  await symlink(resolve(import.meta.dirname, '../../../node_modules'), resolve(root, 'node_modules'), 'dir');
  await writeFile(resolve(root, 'package.json'), '{ "name": "vite-storybook", "private": true, "type": "module" }\n');
  await writeFile(
    resolve(root, '.storybook/main.js'),
    `export default {\n` +
      `  stories: ['../src/*.stories.@(js|jsx)'],\n` +
      `  framework: { name: '@storybook/react-vite', options: {} },\n` +
      `  core: { disableTelemetry: true },\n` +
      `  addons: [{ name: ${JSON.stringify(ADDON)}, options: { root: ${JSON.stringify(root)} } }],\n` +
      // Unminified, so the probes the build placed can be read back by name.
      `  viteFinal: async (config) => ({ ...config, build: { ...config.build, minify: false } }),\n` +
      `};\n`,
  );
  await writeFile(resolve(root, '.storybook/preview.js'), PREVIEW);
  await writeFile(resolve(root, 'src/tone.js'), 'export function tone() {\n  return "red";\n}\n');
  await writeFile(resolve(root, 'src/box.jsx'), 'export function Box({ children }) {\n  return <div>{children}</div>;\n}\n');
  await writeFile(
    resolve(root, 'src/box.stories.jsx'),
    "import { Box } from './box.jsx';\nexport default { title: 'Box', component: Box };\nexport const One = { args: { children: 'one' } };\n",
  );
  await writeFile(resolve(root, 'src/Page.jsx'), 'export function Page() {\n  return <button>Log in</button>;\n}\n');
  await writeFile(resolve(root, 'src/Page.stories.js'), await readFile(INIT_STORY, 'utf8'));
  return root;
}

/** Every JavaScript file the build wrote, joined. */
async function emitted(directory: string): Promise<string> {
  const files = (await readdir(directory, { recursive: true })).filter((file) => file.endsWith('.js'));
  return (await Promise.all(files.map((file) => readFile(resolve(directory, file), 'utf8')))).join('\n');
}

/** What `storybook build --test` wrote for the project above. */
let page: string;

beforeAll(async () => {
  const root = await storybook();
  const out = resolve(root, 'out');
  await run(process.execPath, [STORYBOOK, 'build', '--test', '--quiet', '-o', out], { cwd: root, env: { ...process.env, CI: 'true' } });
  page = await emitted(out);
}, 180_000);

it('builds a preview file with a decorator under `storybook build --test`, its probes where its regions are', () => {
  // Storybook's rewrite still ran: the module is named, not imported.
  expect(page).toMatch(/sb\.mock\(\s*["']\.\.\/src\/tone\.js["']\s*\)/);
  // The probes the file as written is cut into, by ordinal: the branch on line 11, and what follows it on line 12.
  expect(page).toMatch(/__va(?:\$\d+)?\(2\);\s*return Box\(/);
  expect(page).toMatch(/__va(?:\$\d+)?\(4\);\s*return Story\(\);/);
});

it('builds the story `storybook init` writes a JavaScript project, the probes of its `play` on its statements', () => {
  // The function's own probe, then each `await`'s, by ordinal, on the statement the file has it on.
  expect(page).toMatch(/play: async \(\{ canvasElement \}\) => \{\s*__va(?:\$\d+)?\(1\);/);
  expect(page).toMatch(/__vaR(?:\$\d+)?\(await expect\(loginButton\)\.toBeInTheDocument\(\), 2\);/);
  expect(page).toMatch(/__vaR(?:\$\d+)?\(await userEvent\.click\(loginButton\), 3\);/);
  expect(page).toMatch(/__vaR(?:\$\d+)?\(await expect\(loginButton\)\.not\.toBeInTheDocument\(\), 4\);/);
  expect(page).toMatch(/__vaR(?:\$\d+)?\(await expect\(logoutButton\)\.toBeInTheDocument\(\), 5\);/);
});
