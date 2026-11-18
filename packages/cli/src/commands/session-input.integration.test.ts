import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionSources } from '@variance-authority/sense/test-selection';
import { BUNDLE, BUNDLE_MAP, MAIN, MATH } from './session-input.fixture.js';
import { readSession } from './session-input.js';

let root: string;

beforeAll(async () => {
  // Node names a script by its real path, which on macOS is under `/private`.
  root = await realpath(await mkdtemp(join(tmpdir(), 'variance-session-node-')));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'src/math.ts'), MATH);
  await writeFile(join(root, 'src/main.ts'), MAIN);
  await writeFile(join(root, 'dist/main.js'), BUNDLE);
  await writeFile(join(root, 'dist/main.js.map'), JSON.stringify(BUNDLE_MAP));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

it('reads the directory a Node run under NODE_V8_COVERAGE wrote, as Node wrote it', async () => {
  const node = join(root, 'node-coverage');
  execFileSync(process.execPath, [join(root, 'dist/main.js')], { env: { ...process.env, NODE_V8_COVERAGE: node } });
  const session = await readSession(node, undefined);

  expect(session.scripts.map((script) => script.file)).toContain(join(root, 'dist/main.js'));
  const math = sessionSources(session.scripts, 'presence').sources.find((each) => each.file === join(root, 'src/math.ts'));
  expect(Object.fromEntries(math!.functions.map((each) => [each.row.name, each.state]))).toEqual({ add: 'ran', never: 'unknown', twice: 'ran' });
});
