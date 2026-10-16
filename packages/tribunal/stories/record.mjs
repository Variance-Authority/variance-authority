/**
 * What tribunal's stories show, recorded from the product rather than written
 * for it.
 *
 * A story about a review surface is only as honest as the build it reviews. A
 * hand-written `BuildDetail` says what its author remembered the service
 * answering, and it keeps saying it after the service changes. So the data here
 * is made the way an adopter's is: `variance run` photographs
 * `cases/storybook-case` twice — as it is, then with the `wide-button` mutation —
 * `variance push` files both runs with a real tribunal, and a reviewer decides
 * on two of the changes and raises a concern about a third.
 *
 * What it writes is what that service then answers: every read the review page
 * makes, in `recorded/answers.json`, and every image it serves, in
 * `recorded/images`. Nothing of it is committed. The `tribunal` job records it
 * again before it builds the Storybook, so the stories draw what this commit's
 * service answers, photographed in the browser the gate photographs with.
 * Locally, run it once before the Storybook, and again after changing the case,
 * the run report, the push or the service:
 *
 *     yarn build && yarn workspace @variance-authority/tribunal stories:record
 *
 * It launches Chromium and binds a loopback port.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serveTribunal } from '@variance-authority/tribunal/node';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';
import { createReviewClient } from '@variance-authority/tribunal/ui';
import { createTribunal } from '@variance-authority/tribunal/worker';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CASE = join(ROOT, 'cases/storybook-case');
const OUT = join(HERE, 'recorded');
const VARIANCE = join(ROOT, 'packages/cli/dist/bin.js');

const REVIEWER = 'marina';

/** The project the case is filed under, and the two credentials the recording uses. */
const PROJECT = 'storybook-case';
const INGEST = 'stories-ingest-token-0123456789';
const REVIEW = 'stories-review-token-0123456789';

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
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook'], { stdio: 'inherit' });
execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook:changed'], {
  stdio: 'inherit',
});

// The service's clock is the recording's: each write moves it on a minute,
// and each push starts it at its build's hour. Reads leave it where the last
// write did, so a decision's date and a window's edge come out the same on
// every run.
let clock = new Date(BUILDS[0].at);
const { tribunal, service } = await serve();
const baselines = join(work, 'baselines');

for (const [position, one] of BUILDS.entries()) {
  const config = configFor(one, service.url, baselines);
  // 1 is a run that found something to review, which is what both of these are.
  await variance(['run', '--config', config], [0, 1]);
  fileAt(join(work, one.build, 'run.json'), one);
  clock = new Date(one.at);
  await variance(['push', '--config', config, '--run', one.build, '--commit', one.commit, '--branch', one.branch], [0]);
  if (position < BUILDS.length - 1) await variance(['accept', '--config', config, '--all'], [0]);
}

await review(createReviewClient({ endpoint: service.url, token: REVIEW }));
await service.close();

const answers = {};
const files = new Map();
const reading = async (input, init) => {
  const response = await tribunal.fetch(new Request(input, init));
  const url = new URL(response.url || String(input));
  if (!url.pathname.endsWith('.png')) {
    answers[`${url.pathname}${url.search}`] = { status: response.status, body: await response.clone().json() };
  }
  return response;
};
const images = await read(createReviewClient({ endpoint: service.url, token: REVIEW, fetch: reading }), files);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'images'), { recursive: true });
for (const [file, bytes] of files) {
  mkdirSync(dirname(join(OUT, 'images', file)), { recursive: true });
  writeFileSync(join(OUT, 'images', file), bytes);
}
writeFileSync(join(OUT, 'answers.json'), `${JSON.stringify({ answers: sorted(answers), images }, null, 2)}\n`);
process.stdout.write(`recorded ${Object.keys(answers).length} answers and ${files.size} images in ${OUT}\n`);
process.exit(0);

/**
 * The service on a loopback port, its clock moved on by every write it is sent.
 *
 * In this process rather than the `variance-authority-tribunal` program, so its
 * clock is the recording's, and so the answers can be read from it directly.
 */
async function serve() {
  const tribunal = createTribunal({
    db: await createSqliteD1(),
    bucket: createMemoryR2(),
    project: PROJECT,
    ingestToken: INGEST,
    reviewToken: REVIEW,
    now: () => clock,
  });
  const ticking = {
    async fetch(request) {
      const response = await tribunal.fetch(request);
      if (request.method !== 'GET' && request.method !== 'HEAD') clock = new Date(clock.getTime() + 60_000);
      return response;
    },
  };
  const service = await serveTribunal({
    tribunal: ticking,
    host: '127.0.0.1',
    port: 0,
    authorize: capabilityOf,
    tokens: { ingest: INGEST, review: REVIEW },
    ui: false,
  });
  return { tribunal, service };
}

function capabilityOf(request) {
  const header = request.headers.get('authorization');
  return header === `Bearer ${INGEST}` ? 'ingest' : header === `Bearer ${REVIEW}` ? 'review' : null;
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

/**
 * The CLI, from the repository root, because the collector's source dirs are
 * read from there. Never synchronously: the service it pushes to is this
 * process, and a blocked event loop answers nobody.
 */
async function variance(args, accepted) {
  try {
    await promisify(execFile)(process.execPath, [VARIANCE, ...args], {
      cwd: ROOT,
      env: { ...process.env, STORIES_INGEST_TOKEN: INGEST },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (!accepted.includes(error.code)) {
      process.stderr.write(error.stderr ?? '');
      throw error;
    }
  }
}

/** Give a run report the hour and the intent its build is recorded under. */
function fileAt(path, one) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const { intent: _intent, ...rest } = report;
  writeFileSync(path, JSON.stringify({ ...rest, at: one.at, ...(one.intent ? { intent: one.intent } : {}) }));
}

/**
 * A reviewer's pass over the second build: one approval, one rejection, one
 * concern, each on the subject its note is about. A subject the mutation no
 * longer changes stops the recording rather than deciding on something else.
 */
async function review(client) {
  const [, changed] = BUILDS;
  const approve = 'story:case-surface--button-primary';
  const reject = 'story:case-surface--button-secondary';
  const concern = 'story:case-surface--card-rebranded';
  const detail = await client.build(changed.build);
  const pending = new Set(detail.subjects.filter((one) => one.verdict === 'changed').map((one) => one.subject));
  for (const subject of [approve, reject, concern]) {
    if (!pending.has(subject)) throw new Error(`${changed.build} did not change ${subject}, which the review decides on`);
  }
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

/**
 * Every read the review page makes for the recorded builds, each answered and
 * kept, and every image it draws, saved as `<build>/<subject>/<kind>.png` with
 * the subject's `kind:id` as two directories, so a file says what it shows.
 *
 * @returns The file each subject's layer is drawn from, by build, subject and kind.
 */
async function read(client, files) {
  const names = {};
  const builds = (await client.builds()).map((one) => one.build).sort();
  await client.changelog();
  for (const build of builds) {
    const detail = await client.build(build);
    await client.concerns({ seenIn: build });
    const components = new Set();
    for (const subject of detail.subjects) {
      await client.concerns({ subject: subject.subject });
      await client.flakiness(subject.subject);
      for (const region of subject.regions) if (region.component) components.add(region.component);
      for (const moved of subject.moved ?? []) components.add(moved.component);
      for (const kind of ['before', 'after', 'diff']) {
        if (!subject.has[kind]) continue;
        const bytes = new Uint8Array(await (await client.imageBlob(build, subject.subject, kind)).arrayBuffer());
        const file = `${build}/${subject.subject.split(':').join('/')}/${kind}.png`;
        files.set(file, bytes);
        ((names[build] ??= {})[subject.subject] ??= {})[kind] = file;
      }
    }
    for (const component of [...components].sort()) {
      await client.changelog({ component });
      await client.churn(component);
      await client.reach(component);
    }
  }
  return names;
}

/** Keys in code-unit order, so the same answers are always the same file. */
function sorted(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
