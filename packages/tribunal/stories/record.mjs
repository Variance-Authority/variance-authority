/**
 * What tribunal's stories show, recorded from the product rather than written
 * for it.
 *
 * A story about a review surface is only as honest as the build it reviews. A
 * hand-written `BuildDetail` says what its author remembered the service
 * answering, and it keeps saying it after the service changes. So the data here
 * is made the way an adopter's is: `variance run` photographs
 * `cases/storybook-case` twice — as it is, then with the `wide-button` mutation —
 * `variance push` files both runs with a real `variance-authority-tribunal`, and
 * a reviewer decides on two of the changes and raises a concern about a third.
 * Every answer the review page asks for is then read back through
 * `createReviewClient` and written to `recorded/`, which the stories replay.
 *
 * Run it again when the service's answers change shape, and commit what it
 * writes:
 *
 *     yarn build && yarn workspace @variance-authority/tribunal stories:record
 *
 * It launches Chromium and binds a loopback port.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReviewClient } from '@variance-authority/tribunal/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CASE = join(ROOT, 'cases/storybook-case');
const OUT = join(HERE, 'recorded');
const VARIANCE = join(ROOT, 'packages/cli/dist/bin.js');
const TRIBUNAL = join(ROOT, 'packages/tribunal/dist/node/bin.js');

const INGEST = 'stories-ingest-token-0123456789';
const REVIEW = 'stories-review-token-0123456789';
const REVIEWER = 'marina';

/**
 * The two builds, each with the hour its run is filed at. Fixed, so recording
 * again moves no date on any page that was not otherwise changed.
 */
const BUILDS = [
  { build: 'ci-101', commit: '3f2a9c1', branch: 'main', index: 'storybook-static', at: '2026-06-01T09:00:00.000Z' },
  {
    build: 'ci-102',
    commit: '8d41e07',
    branch: 'feat/wide-button',
    index: 'storybook-changed',
    at: '2026-06-01T10:00:00.000Z',
    intent: 'give the primary button more room',
  },
];

const work = mkdtempSync(join(tmpdir(), 'tribunal-stories-'));
const children = [];
process.on('exit', () => {
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true });
});

execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook'], { stdio: 'inherit' });
execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook:changed'], {
  stdio: 'inherit',
});

const endpoint = await serve();
const baselines = join(work, 'baselines');

for (const [position, one] of BUILDS.entries()) {
  const config = configFor(one, endpoint, baselines);
  // 1 is a run that found something to review, which is what both of these are.
  variance(['run', '--config', config], [0, 1]);
  fileAt(join(work, one.build, 'run.json'), one);
  variance(['push', '--config', config, '--run', one.build, '--commit', one.commit, '--branch', one.branch], [0]);
  if (position < BUILDS.length - 1) variance(['accept', '--config', config, '--all'], [0]);
}

const answers = {};
const recording = async (input, init) => {
  const response = await fetch(input, init);
  const url = new URL(typeof input === 'string' ? input : input.url);
  if ((init?.method ?? 'GET') === 'GET' && !url.pathname.endsWith('.png')) {
    answers[`${url.pathname}${url.search}`] = { status: response.status, body: await response.clone().json() };
  }
  return response;
};
const client = createReviewClient({ endpoint, token: REVIEW, fetch: recording });

await review(client);
const images = await read(client);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'images'), { recursive: true });
for (const [file, bytes] of images.files) writeFileSync(join(OUT, 'images', file), bytes);
writeFileSync(
  join(OUT, 'answers.json'),
  `${JSON.stringify({ answers: sorted(answers), images: images.names }, null, 2)}\n`,
);
process.stdout.write(`recorded ${Object.keys(answers).length} answers and ${images.files.size} images in ${OUT}\n`);
process.exit(0);

/** Start the deployment on a free loopback port, and answer its URL. */
async function serve() {
  const child = spawn(process.execPath, [TRIBUNAL], {
    env: {
      ...process.env,
      VARIANCE_TRIBUNAL_PORT: '0',
      VARIANCE_TRIBUNAL_PROJECT: 'storybook-case',
      VARIANCE_TRIBUNAL_DB: join(work, 'tribunal.db'),
      VARIANCE_TRIBUNAL_STORAGE: join(work, 'objects'),
      VARIANCE_TRIBUNAL_INGEST_TOKEN: INGEST,
      VARIANCE_TRIBUNAL_REVIEW_TOKEN: REVIEW,
      VARIANCE_TRIBUNAL_REVIEWER: REVIEWER,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(child);
  return await new Promise((done, fail) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += String(chunk);
      const listening = /listening on (\S+)/.exec(text);
      if (listening !== null) done(listening[1]);
    });
    child.once('exit', (code) => fail(new Error(`variance-authority-tribunal exited ${code} before listening:\n${text}`)));
  });
}

/** The case's own config, pointed at one build of its Storybook and at the deployment. */
function configFor(one, endpoint, baselines) {
  const config = JSON.parse(readFileSync(join(CASE, 'variance.config.json'), 'utf8'));
  delete config.share;
  const dir = join(work, one.build);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'variance.config.json');
  const written = {
    ...config,
    subjects: {
      ...config.subjects,
      index: join(CASE, one.index, 'index.json'),
      collector: join(CASE, config.subjects.collector),
    },
    baselines: { kind: 'directory', root: baselines },
    report: join(dir, 'run.json'),
    images: join(dir, 'images'),
    review: { endpoint, token: { env: 'STORIES_INGEST_TOKEN' } },
  };
  writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`);
  return file;
}

/** The CLI, from the repository root, because the collector's source dirs are read from there. */
function variance(args, accepted) {
  try {
    execFileSync(process.execPath, [VARIANCE, ...args], {
      cwd: ROOT,
      env: { ...process.env, STORIES_INGEST_TOKEN: INGEST },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch (error) {
    if (!accepted.includes(error.status)) throw error;
  }
}

/** Give a run report the hour and the intent its build is recorded under. */
function fileAt(path, one) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const { intent: _intent, ...rest } = report;
  writeFileSync(path, JSON.stringify({ ...rest, at: one.at, ...(one.intent ? { intent: one.intent } : {}) }));
}

/** A reviewer's pass over the second build: one approval, one rejection, one concern. */
async function review(client) {
  const [, changed] = BUILDS;
  const detail = await client.build(changed.build);
  const pending = detail.subjects.filter((one) => one.verdict === 'changed').map((one) => one.subject).sort();
  const [approve, reject, concern] = pending;
  await client.decide(changed.build, approve, 'approved', REVIEWER, 'the wider padding is the change we asked for');
  await client.decide(changed.build, reject, 'rejected', REVIEWER, 'the secondary button was not meant to move');
  await client.raise({
    build: changed.build,
    subject: concern,
    title: 'Card grows by six pixels when its button does',
    by: REVIEWER,
    note: 'The card follows its content; check whether a fixed height was intended.',
    hypothesis: 'the card has no min-height, so the button padding reflows it',
  });
}

/** Every read the review page makes for these builds, so the replay answers each one. */
async function read(client) {
  const files = new Map();
  const names = {};
  await client.builds();
  await client.changelog();
  for (const { build } of BUILDS) {
    const detail = await client.build(build);
    await client.concerns({ seenIn: build });
    const components = new Set();
    for (const [position, subject] of detail.subjects.entries()) {
      await client.concerns({ subject: subject.subject });
      await client.flakiness(subject.subject);
      for (const region of subject.regions) if (region.component) components.add(region.component);
      for (const moved of subject.moved ?? []) components.add(moved.component);
      for (const kind of ['before', 'after', 'diff']) {
        if (!subject.has[kind]) continue;
        const file = `${build}-${String(position).padStart(2, '0')}.${kind}.png`;
        files.set(file, Buffer.from(await (await client.imageBlob(build, subject.subject, kind)).arrayBuffer()));
        ((names[build] ??= {})[subject.subject] ??= {})[kind] = file;
      }
    }
    for (const component of [...components].sort()) {
      await client.changelog({ component });
      await client.churn(component);
      await client.reach(component);
    }
  }
  return { files, names };
}

/** Keys in code-unit order, so recording twice writes the same file. */
function sorted(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
